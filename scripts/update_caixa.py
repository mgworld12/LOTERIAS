#!/usr/bin/env python3
"""Atualiza o espelho incremental dos resultados CAIXA para o GitHub Pages.

Fonte: endpoint JSON não documentado usado pelo Portal Loterias CAIXA.

Saída (pasta data/):
  index.json        resumo pequeno, lido primeiro pelo site
  <modalidade>.json um arquivo por modalidade (ex.: megasena.json)

Comportamento:
  * grava checkpoints durante a execução (nada se perde se o job for interrompido);
  * um concurso com problema é registrado e PULADO, não trava o restante;
  * lacunas no histórico são detectadas e preenchidas nas execuções seguintes;
  * respeita um orçamento de tempo (TIME_BUDGET_SECONDS) e encerra de forma limpa;
  * modalidades com menos concursos pendentes são processadas primeiro.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

API = "https://servicebus2.caixa.gov.br/portaldeloterias/api/"
DATA = Path("data")
INDEX = DATA / "index.json"
LEGACY = DATA / "results.json"  # formato antigo (schema 1), migrado automaticamente
SCHEMA = 2
SOURCE = "Portal Loterias CAIXA (endpoint JSON não documentado)"

TIME_BUDGET = float(os.environ.get("TIME_BUDGET_SECONDS", 5 * 3600 + 20 * 60))
SAVE_EVERY = 100  # concursos novos entre checkpoints
MAX_CONSECUTIVE_FAILURES = 12  # indica bloqueio/instabilidade: aborta a modalidade
PAUSE = 0.2  # segundos entre requisições

# slug -> (quantidade de dezenas, máximo, aceita zero)
MODALITIES = {
    "megasena": (6, 60, False),
    "lotofacil": (15, 25, False),
    "quina": (5, 80, False),
    "lotomania": (20, 99, True),
    "duplasena": (6, 50, False),
    "diadesorte": (7, 31, False),
    "timemania": (7, 80, False),
    "supersete": (7, 9, False),
    "maismilionaria": (6, 50, False),
}
MONTHS = {
    name.lower(): i
    for i, name in enumerate(
        "Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro".split(), 1
    )
}


class NotFound(Exception):
    """Concurso inexistente na API (HTTP 404): não adianta tentar de novo."""


def get_json(url: str):
    req = Request(
        url,
        headers={
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (compatible; LoteriasCaixaGitHubPages/2.0)",
            "Referer": "https://loterias.caixa.gov.br/",
        },
    )
    last = None
    for attempt in range(4):
        try:
            with urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8-sig"))
        except HTTPError as exc:
            if exc.code == 404:
                raise NotFound(url) from exc
            last = exc
        except Exception as exc:  # rede, JSON inválido, timeout…
            last = exc
        if attempt < 3:
            time.sleep(2**attempt)
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
    """Valida e converte um concurso. As dezenas principais são obrigatórias;
    campos extras ausentes (time, mês, trevos, 2º sorteio) marcam o registro
    como incompleto em vez de impedir a leitura do restante do histórico."""
    count, maximum, zero = MODALITIES[kind]
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
    incomplete = False

    if kind == "megasena":
        # Mega da Virada: concurso especial da Mega-Sena, não uma modalidade própria.
        special = " ".join(
            str(raw.get(k) or "")
            for k in ("nomeConcursoEspecial", "descricaoConcurso", "nomeEspecial", "concursoEspecial", "descricao")
        ).casefold()
        if "mega da virada" in special or date[5:] == "12-31":
            item["specialDraw"] = "mega-da-virada"
    elif kind == "duplasena":
        second = numbers(
            {"x": raw.get("listaDezenasSegundoSorteio") or raw.get("dezenasSegundoSorteio") or raw.get("listaDezenas2")},
            "x",
        )
        if len(second) == 6 and len(set(second)) == 6 and all(1 <= n <= 50 for n in second):
            item["secondNumbers"] = second
        else:
            incomplete = True
    elif kind == "maismilionaria":
        raw_t = raw.get("trevosSorteados") or raw.get("listaTrevosSorteados") or raw.get("listaTrevos") or raw.get("trevos") or []
        trevos = []
        for x in raw_t:
            v = (x.get("numero") or x.get("trevo") or x.get("numeroTrevo") or "") if isinstance(x, dict) else x
            digits = re.sub(r"\D", "", str(v))
            if digits:
                trevos.append(int(digits))
        trevos = [n for n in trevos if 1 <= n <= 6]
        if len(trevos) == 2 and len(set(trevos)) == 2:
            item["trevos"] = trevos
        else:
            incomplete = True
    elif kind == "diadesorte":
        month = month_number(raw.get("mesSorte") or raw.get("mesSorteado") or raw.get("mes") or raw.get("nomeTimeCoracaoMesSorte"))
        if month:
            item["month"] = month
        else:
            incomplete = True
    elif kind == "timemania":
        team = str(raw.get("nomeTimeCoracao") or raw.get("timeCoracao") or raw.get("timeDoCoracao") or raw.get("nomeTimeCoracaoMesSorte") or "").strip()
        if team:
            item["team"] = team
        else:
            incomplete = True
    elif kind == "supersete":
        item["columns"] = nums[:]
    if incomplete:
        item["incomplete"] = True
    return item


# ---------------------------------------------------------------- armazenamento
def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"


def load_store():
    """Lê os arquivos por modalidade (e migra o results.json antigo, se houver)."""
    store = {kind: {} for kind in MODALITIES}
    for kind in MODALITIES:
        path = DATA / f"{kind}.json"
        if path.exists():
            for d in json.loads(path.read_text("utf-8")).get("draws", []):
                store[kind][int(d["contest"])] = d
    if LEGACY.exists():
        try:
            for d in json.loads(LEGACY.read_text("utf-8")).get("draws", []):
                if d.get("type") in store:
                    store[d["type"]].setdefault(int(d["contest"]), d)
        except (ValueError, OSError):
            pass
    for contests in store.values():  # retrocompatibilidade do marcador da Mega da Virada
        for d in contests.values():
            if d.get("type") == "megasena" and str(d.get("date", "")).endswith("-12-31"):
                d["specialDraw"] = "mega-da-virada"
    return store


def write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text("utf-8") == text:
        return False
    path.write_text(text, "utf-8")
    return True


def save_all(store, tops, errors, prev_index):
    """Grava arquivos de modalidade alterados e o index.json. Retorna True se algo mudou."""
    DATA.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    # compara sempre com o que está em disco (um checkpoint anterior pode ter mudado o arquivo)
    prev_index = json.loads(INDEX.read_text("utf-8")) if INDEX.exists() else prev_index
    prev_mods = prev_index.get("modalities", {})
    mods, changed = {}, False
    for kind, contests in store.items():
        if not contests:
            continue
        ordered = [contests[c] for c in sorted(contests)]
        file = f"{kind}.json"
        file_changed = write_if_changed(DATA / file, dumps({"schemaVersion": SCHEMA, "type": kind, "draws": ordered}))
        top = tops.get(kind) or ordered[-1]["contest"]
        prev = prev_mods.get(kind, {})
        mods[kind] = {
            "file": file,
            "count": len(ordered),
            "latest": ordered[-1]["contest"],
            "latestDate": ordered[-1]["date"],
            "missing": max(0, top - len(ordered)),
            "incomplete": sum(1 for d in ordered if d.get("incomplete")),
            "updatedAt": now if file_changed or not prev.get("updatedAt") else prev["updatedAt"],
        }
        changed = changed or file_changed
    total_missing = sum(m["missing"] for m in mods.values())
    base = {
        "schemaVersion": SCHEMA,
        "source": SOURCE,
        "status": "ok" if not errors and not total_missing and len(mods) == len(MODALITIES) else "partial",
        "errors": sorted(set(errors)),
        "modalities": mods,
    }
    prev_cmp = {k: prev_index.get(k) for k in base}
    # generatedAt só muda quando algo muda: evita commit vazio a cada execução.
    if changed or prev_cmp != base or not prev_index.get("generatedAt"):
        base["generatedAt"] = now if (changed or not prev_index.get("generatedAt")) else prev_index["generatedAt"]
        index_changed = write_if_changed(INDEX, dumps(base))
        changed = changed or index_changed
    return changed


# ---------------------------------------------------------------- sincronização
QUOTA = 120  # concursos por modalidade a cada passada (todas avançam em paralelo)


def main():
    """Busca os concursos que faltam, do MAIS RECENTE para o mais antigo, em passadas
    que alternam entre as modalidades. Assim, mesmo uma rodada curta já deixa todas as
    modalidades utilizáveis (com os concursos mais recentes) e o site pode publicar cedo."""
    deadline = time.monotonic() + TIME_BUDGET
    DATA.mkdir(parents=True, exist_ok=True)
    prev_index = json.loads(INDEX.read_text("utf-8")) if INDEX.exists() else {}
    store = load_store()
    errors, tops = [], {}

    # Fase 1: descobrir o último concurso de cada modalidade.
    for kind in MODALITIES:
        try:
            item = normalize(kind, get_json(API + kind))
            tops[kind] = item["contest"]
            store[kind][item["contest"]] = item
        except Exception as exc:
            errors.append(f"{kind}: {exc}")
            print(f"::warning::{kind}: {exc}")
    if not any(store.values()):
        raise RuntimeError("Nenhum resultado oficial foi confirmado; nada será gravado.")

    def checkpoint():
        save_all(store, tops, list(errors), prev_index)

    # Fase 2: preencher pendências, newest-first, alternando modalidades.
    pending = {k: [c for c in range(tops[k], 0, -1) if c not in store[k]] for k in tops}
    fails = {k: 0 for k in tops}
    failed = {k: [] for k in tops}
    paused = set()
    added = 0
    active = lambda: [k for k in sorted(tops, key=lambda k: len(pending[k])) if pending[k] and k not in paused]
    while active() and time.monotonic() < deadline:
        for kind in active():
            for _ in range(QUOTA):
                if not pending[kind] or time.monotonic() >= deadline:
                    break
                contest = pending[kind].pop(0)
                try:
                    item = normalize(kind, get_json(f"{API}{kind}/{contest}"))
                    if item["contest"] != contest:
                        raise ValueError(f"resposta trouxe o concurso {item['contest']}")
                    store[kind][contest] = item
                    added += 1
                    fails[kind] = 0
                except NotFound:
                    failed[kind].append(contest)
                except Exception as exc:
                    failed[kind].append(contest)
                    fails[kind] += 1
                    print(f"::warning::{kind} {contest}: {exc}")
                    if fails[kind] >= MAX_CONSECUTIVE_FAILURES:
                        errors.append(
                            f"{kind}: {fails[kind]} falhas seguidas (último concurso {contest}: {exc}); modalidade pausada"
                        )
                        paused.add(kind)
                        break
                time.sleep(PAUSE)
            checkpoint()
    for kind, lst in failed.items():
        if lst:
            sample = ", ".join(map(str, sorted(lst)[:8])) + ("…" if len(lst) > 8 else "")
            errors.append(f"{kind}: {len(lst)} concurso(s) não confirmado(s) nesta execução ({sample})")
    save_all(store, tops, errors, prev_index)
    left = sum(len(v) for v in pending.values())
    print(f"Concursos adicionados: {added}; ainda pendentes: {left}; total no espelho: {sum(len(v) for v in store.values())}")
    for e in errors:
        print(f"::warning::{e}")


if __name__ == "__main__":
    main()
