#!/usr/bin/env python3
"""Atualiza o espelho incremental dos resultados CAIXA para o GitHub Pages.
A fonte é o endpoint JSON não documentado usado pelo Portal Loterias CAIXA.
"""
from __future__ import annotations
import json, os, re, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

API = "https://servicebus2.caixa.gov.br/portaldeloterias/api/"
OUT = Path("data/results.json")
MODALITIES = {
    "megasena": ("megasena", 6, 60, False),
    "lotofacil": ("lotofacil", 15, 25, False),
    "quina": ("quina", 5, 80, False),
    "lotomania": ("lotomania", 20, 99, True),
    "duplasena": ("duplasena", 6, 50, False),
    "diadesorte": ("diadesorte", 7, 31, False),
    "timemania": ("timemania", 7, 80, False),
    "supersete": ("supersete", 7, 9, False),
    "maismilionaria": ("maismilionaria", 6, 50, False),
}
MONTHS = {name.lower(): i for i, name in enumerate(("Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro").split(), 1)}


def get_json(url: str):
    req = Request(url, headers={"Accept": "application/json, text/plain, */*", "User-Agent": "Mozilla/5.0 (compatible; LoteriasCaixaGitHubPages/1.0)", "Referer": "https://loterias.caixa.gov.br/"})
    last = None
    for attempt in range(4):
        try:
            with urlopen(req, timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                return json.loads(response.read().decode("utf-8-sig"))
        except Exception as exc:
            last = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Falha ao consultar CAIXA: {last}")


def numbers(data, *keys):
    for key in keys:
        value = data.get(key)
        if isinstance(value, list) and value:
            return [int(re.sub(r"\D", "", str(x))) for x in value]
    return []


def month_number(value):
    if isinstance(value, (int, float)) or str(value).isdigit():
        n = int(value)
        return n if 1 <= n <= 12 else None
    norm = str(value or "").strip().lower()
    for name, n in MONTHS.items():
        if name in norm:
            return n
    return None


def normalize(kind, raw):
    slug, count, maximum, zero = MODALITIES[kind]
    contest = int(raw.get("numero") or raw.get("numeroConcurso") or raw.get("concurso") or 0)
    date_raw = str(raw.get("dataApuracao") or "")
    try:
        date = datetime.strptime(date_raw, "%d/%m/%Y").date().isoformat()
    except ValueError:
        raise ValueError(f"Data inválida no concurso {contest}: {date_raw!r}")
    nums = numbers(raw, "listaDezenas", "dezenasSorteadasOrdemSorteio", "dezenasSorteadas", "dezenas")
    if len(nums) != count or (kind != "supersete" and len(set(nums)) != count):
        raise ValueError(f"Dezenas incompletas/duplicadas em {kind} {contest}")
    low = 0 if zero or kind == "supersete" else 1
    if any(n < low or n > maximum for n in nums):
        raise ValueError(f"Dezena fora do intervalo em {kind} {contest}")
    item = {"type": kind, "contest": contest, "date": date, "numbers": nums}
    if kind == "duplasena":
        second = numbers({"x": raw.get("listaDezenasSegundoSorteio") or raw.get("dezenasSegundoSorteio") or raw.get("listaDezenas2")}, "x")
        if len(second) != 6 or len(set(second)) != 6 or any(n < 1 or n > 50 for n in second):
            raise ValueError(f"Segundo sorteio incompleto na Dupla Sena {contest}")
        item["secondNumbers"] = second
    elif kind == "maismilionaria":
        trevos_raw = raw.get("trevosSorteados") or raw.get("listaTrevosSorteados") or raw.get("listaTrevos") or raw.get("trevos") or []
        trevos = [int(re.sub(r"\D", "", str(x.get("numero") or x.get("trevo") or x.get("numeroTrevo") or "" if isinstance(x, dict) else x))) for x in trevos_raw]
        trevos = [n for n in trevos if 1 <= n <= 6]
        if len(trevos) != 2 or len(set(trevos)) != 2:
            raise ValueError(f"Trevos incompletos na +Milionária {contest}")
        item["trevos"] = trevos
    elif kind == "diadesorte":
        month = month_number(raw.get("mesSorte") or raw.get("mesSorteado") or raw.get("mes") or raw.get("nomeTimeCoracaoMesSorte"))
        if not month:
            raise ValueError(f"Mês da sorte ausente no Dia de Sorte {contest}")
        item["month"] = month
    elif kind == "timemania":
        team = str(raw.get("nomeTimeCoracao") or raw.get("timeCoracao") or raw.get("timeDoCoracao") or raw.get("nomeTimeCoracaoMesSorte") or "").strip()
        if not team:
            raise ValueError(f"Time do coração ausente na Timemania {contest}")
        item["team"] = team
    elif kind == "supersete":
        item["columns"] = nums[:]
    return item


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    old = { (d["type"], int(d["contest"])): d for d in json.loads(OUT.read_text("utf-8")).get("draws", []) } if OUT.exists() else {}
    added = 0
    errors = []
    for kind, (slug, *_rest) in MODALITIES.items():
        try:
            latest_raw = get_json(API + slug)
            latest = normalize(kind, latest_raw)
            existing = sorted(c for t, c in old if t == kind)
            start = (existing[-1] + 1) if existing else latest["contest"]
            if start > latest["contest"]:
                continue
            for contest in range(start, latest["contest"] + 1):
                raw = latest_raw if contest == latest["contest"] else get_json(f"{API}{slug}/{contest}")
                item = normalize(kind, raw)
                if item["contest"] != contest:
                    raise ValueError(f"Resposta retornou concurso {item['contest']} ao solicitar {contest}")
                old[(kind, contest)] = item
                added += 1
                time.sleep(0.15)
        except Exception as exc:
            errors.append(f"{kind}: {exc}")
            print(f"::warning::{kind}: {exc}")
    if not old:
        raise RuntimeError("Nenhum resultado oficial foi confirmado; arquivo não será criado.")
    payload = {
        "schemaVersion": 1,
        "source": "Portal Loterias CAIXA (endpoint JSON não documentado)",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "partial" if errors else "ok",
        "errors": errors,
        "draws": sorted(old.values(), key=lambda d: (d["type"], d["contest"])),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Resultados confirmados adicionados: {added}; total no espelho: {len(old)}")
    if errors:
        print("::warning::Atualização parcial. Consulte errors em data/results.json")


if __name__ == "__main__":
    main()
