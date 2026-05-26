#!/usr/bin/env python3
"""
Sincroniza um projeto real com o RAG.
Rode dentro do seu projeto real ou passe o caminho como argumento.

Uso:
  python3 /path/to/Rag/scripts/sync.py                    # usa CWD como projeto
  python3 /path/to/nodum/scripts/sync.py /Dev/meu-projeto  # caminho explícito
  python3 /path/to/Rag/scripts/sync.py --list             # listar projetos no RAG
  python3 /path/to/Rag/scripts/sync.py --status           # status de todos
"""

import json
import sys
import subprocess
from pathlib import Path
from datetime import datetime

NODUM_ROOT = Path(__file__).parent.parent        # nodum repo root
DATA_ROOT  = NODUM_ROOT / 'data'                 # all synced project data lives here
RAG_ROOT   = DATA_ROOT                           # alias kept for internal use

# ── Análise automática do projeto ─────────────────────────────────────────────

def analyze_project(project_path: Path) -> dict:
    """Extrai informações reais do projeto para preencher o RESUMO.md."""
    info = {
        'description': '',
        'stack': [],
        'run_commands': [],
        'env_vars': [],
        'main_deps': [],
        'dev_deps': [],
        'scripts': {},
        'structure_notes': [],
    }

    # ── README ────────────────────────────────────────────────────────────────
    for readme in ['README.md', 'readme.md', 'README.txt', 'README']:
        f = project_path / readme
        if f.exists():
            lines = f.read_text(errors='ignore').split('\n')
            # Pegar primeiro parágrafo não-vazio após o título
            in_content = False
            for line in lines:
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    if in_content:
                        break
                    continue
                if not in_content:
                    in_content = True
                info['description'] += stripped + ' '
                if len(info['description']) > 300:
                    break
            info['description'] = info['description'].strip()[:300]
            break

    # ── package.json (Node/JS/TS) ─────────────────────────────────────────────
    pkg_file = project_path / 'package.json'
    if pkg_file.exists():
        try:
            pkg = json.loads(pkg_file.read_text())

            if not info['description'] and pkg.get('description'):
                info['description'] = pkg['description']

            # Scripts
            scripts = pkg.get('scripts', {})
            info['scripts'] = scripts
            for key in ('dev', 'start', 'serve', 'build', 'test'):
                if key in scripts:
                    info['run_commands'].append(f'npm run {key}  # {scripts[key]}')

            # Detectar framework/stack pelos deps
            deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}
            dep_names = list(deps.keys())

            frameworks = {
                'next': 'Next.js', 'react': 'React', 'vue': 'Vue',
                'svelte': 'Svelte', 'angular': '@angular/core',
                'express': 'Express', 'fastify': 'Fastify', 'hapi': 'Hapi',
                'koa': 'Koa', 'nestjs': 'NestJS', '@nestjs/core': 'NestJS',
                'nuxt': 'Nuxt',
            }
            dbs = {
                'prisma': 'Prisma ORM', '@prisma/client': 'Prisma ORM',
                'mongoose': 'MongoDB (Mongoose)', 'sequelize': 'Sequelize ORM',
                'typeorm': 'TypeORM', 'pg': 'PostgreSQL (pg)',
                'mysql2': 'MySQL', 'sqlite3': 'SQLite', 'redis': 'Redis',
                'ioredis': 'Redis (ioredis)', 'drizzle-orm': 'Drizzle ORM',
            }
            infra = {
                'axios': 'Axios', 'zod': 'Zod', 'joi': 'Joi',
                'jsonwebtoken': 'JWT', 'bcrypt': 'bcrypt', 'bcryptjs': 'bcrypt',
                'dotenv': 'dotenv', 'cors': 'CORS', 'helmet': 'Helmet',
                'jest': 'Jest', 'vitest': 'Vitest', 'eslint': 'ESLint',
                'typescript': 'TypeScript', 'tsx': 'TSX',
                'socket.io': 'Socket.io', 'ws': 'WebSocket (ws)',
                'bullmq': 'BullMQ', 'bull': 'Bull', 'amqplib': 'RabbitMQ',
            }

            found_fw, found_db, found_infra = [], [], []
            for d in dep_names:
                if d in frameworks: found_fw.append(frameworks[d])
                if d in dbs:        found_db.append(dbs[d])
                if d in infra:      found_infra.append(infra[d])

            lang = 'TypeScript' if 'typescript' in dep_names or (project_path / 'tsconfig.json').exists() else 'JavaScript'
            runtime = 'Node.js'
            if 'bun' in dep_names or (project_path / 'bun.lockb').exists():
                runtime = 'Bun'

            info['stack'] = [f'{runtime} + {lang}'] + list(dict.fromkeys(found_fw + found_db + found_infra))
            info['main_deps'] = found_fw + found_db
        except Exception:
            pass

    # ── Python ────────────────────────────────────────────────────────────────
    pyproject = project_path / 'pyproject.toml'
    requirements = project_path / 'requirements.txt'

    if pyproject.exists():
        content = pyproject.read_text(errors='ignore')
        info['stack'].insert(0, 'Python')
        # Extrair description do pyproject.toml
        import re
        m = re.search(r'description\s*=\s*"([^"]+)"', content)
        if m and not info['description']:
            info['description'] = m.group(1)
        # Detectar frameworks
        for fw in ['fastapi', 'django', 'flask', 'starlette', 'tornado', 'aiohttp']:
            if fw in content.lower():
                info['stack'].append(fw.capitalize())
        for db in ['sqlalchemy', 'tortoise', 'pymongo', 'motor', 'redis', 'prisma']:
            if db in content.lower():
                info['stack'].append(db)

    elif requirements.exists():
        content = requirements.read_text(errors='ignore').lower()
        info['stack'].insert(0, 'Python')
        for fw in ['fastapi', 'django', 'flask', 'starlette', 'aiohttp', 'tornado']:
            if fw in content:
                info['stack'].append(fw.capitalize())
        for db in ['sqlalchemy', 'pymongo', 'motor', 'redis', 'psycopg2', 'asyncpg']:
            if db in content:
                info['stack'].append(db)

    # ── Go ────────────────────────────────────────────────────────────────────
    go_mod = project_path / 'go.mod'
    if go_mod.exists():
        content = go_mod.read_text(errors='ignore')
        info['stack'].insert(0, 'Go')
        for pkg in ['gin-gonic/gin', 'labstack/echo', 'gofiber/fiber', 'gorilla/mux']:
            if pkg in content:
                info['stack'].append(pkg.split('/')[-1].capitalize())

    # ── Rust ──────────────────────────────────────────────────────────────────
    cargo = project_path / 'Cargo.toml'
    if cargo.exists():
        info['stack'].insert(0, 'Rust')

    # ── Docker / infra ────────────────────────────────────────────────────────
    if (project_path / 'docker-compose.yml').exists() or (project_path / 'docker-compose.yaml').exists():
        info['stack'].append('Docker Compose')
        info['run_commands'].append('docker compose up -d')
    if (project_path / 'Dockerfile').exists():
        info['stack'].append('Docker')

    # ── Makefile ──────────────────────────────────────────────────────────────
    makefile = project_path / 'Makefile'
    if makefile.exists():
        import re
        targets = re.findall(r'^([a-zA-Z][a-zA-Z0-9_-]*):', makefile.read_text(), re.M)
        for t in targets[:6]:
            info['run_commands'].append(f'make {t}')

    # ── .env.example ─────────────────────────────────────────────────────────
    for env_sample in ['.env.example', '.env.sample', '.env.template', '.env.dist']:
        ef = project_path / env_sample
        if ef.exists():
            import re
            keys = re.findall(r'^([A-Z][A-Z0-9_]+)\s*=', ef.read_text(), re.M)
            info['env_vars'] = keys[:20]
            break

    # ── Dedupe stack ──────────────────────────────────────────────────────────
    info['stack'] = list(dict.fromkeys(info['stack']))

    return info


def build_resumo(name: str, info: dict, graph_stats: dict, graph_nodes: list, project_path: Path = None) -> str:
    """Monta o conteúdo do RESUMO.md com os dados extraídos."""
    lines = [f'# {name}', '']

    # Descrição
    if info['description']:
        lines += [f'> {info["description"]}', '']
    else:
        lines += ['> Projeto sincronizado automaticamente pelo RAG.', '']

    # Stack
    lines += ['## Stack', '']
    if info['stack']:
        for s in info['stack']:
            lines.append(f'- {s}')
    else:
        lines.append('- (detectar manualmente)')
    lines.append('')

    # Como rodar
    lines += ['## Como rodar', '', '```bash']
    if info['run_commands']:
        for cmd in info['run_commands'][:5]:
            lines.append(cmd)
    else:
        lines.append('# Ver README para instruções')
    lines += ['```', '']

    # Variáveis de ambiente
    if info['env_vars']:
        lines += ['## Variáveis de ambiente', '']
        for v in info['env_vars']:
            lines.append(f'- `{v}`')
        lines.append('')

    # Estrutura do código (via grafo)
    groups = {}
    for node in graph_nodes:
        if node.get('type') == 'file':
            g = node.get('group', 'other')
            groups[g] = groups.get(g, 0) + 1

    if groups:
        lines += ['## Estrutura', '']
        order = ['api', 'service', 'model', 'ui', 'hook', 'util', 'config', 'test', 'other']
        for g in order:
            if g in groups:
                lines.append(f'- **{g}** — {groups[g]} arquivo(s)')
        for g in groups:
            if g not in order:
                lines.append(f'- **{g}** — {groups[g]} arquivo(s)')
        lines.append('')

    # Stats
    lines += ['## Stats (último sync)', '']
    lines.append(f'- Arquivos: {graph_stats.get("files", 0)}')
    lines.append(f'- Funções:  {graph_stats.get("functions", 0)}')
    lines.append(f'- Classes:  {graph_stats.get("classes", 0)}')
    lines.append(f'- Arestas:  {graph_stats.get("edges", 0)}')
    lines.append('')

    # Seções para preencher manualmente
    lines += [
        '## Depende de',
        '- (preencher — outros serviços/repos que este projeto consome)',
        '',
        '## Expõe para',
        '- (preencher — quem consome este serviço)',
        '',
        '## Observações',
        '- (preencher — decisões arquiteturais, gotchas, contexto importante)',
        '',
    ]

    # Adicionar caminho do projeto como comentário HTML (invisível no MD, legível pelo sync)
    if project_path:
        lines.append(f'<!-- RAG_PROJECT_PATH: {project_path.resolve()} -->')

    return '\n'.join(lines)


def project_slug(path: Path) -> str:
    return path.name


def get_rag_dir(project_name: str) -> Path:
    return RAG_ROOT / project_name


def sync_project(project_path: Path):
    name = project_slug(project_path)
    rag_dir = get_rag_dir(name)

    print(f"\n{'─' * 60}")
    print(f"🔄 Sincronizando: {name}")
    print(f"   Projeto real: {project_path}")
    print(f"   RAG dir:      {rag_dir}")
    print(f"{'─' * 60}")

    # Criar estrutura no RAG
    (rag_dir / 'graph').mkdir(parents=True, exist_ok=True)
    (rag_dir / 'memory').mkdir(parents=True, exist_ok=True)
    (rag_dir / 'logs').mkdir(parents=True, exist_ok=True)

    # 1. Gerar grafo
    graph_gen = NODUM_ROOT / 'scripts' / 'graph_gen.py'
    out_graph = rag_dir / 'graph'

    print(f"\n📊 Gerando grafo...")
    print(f"   Lendo código em: {project_path}")
    print(f"   Salvando em:     {out_graph}/graph.json")

    # Roda direto sem capture para o erro aparecer na tela
    ret = subprocess.run(
        [sys.executable, str(graph_gen),
         str(project_path), name, str(out_graph)]
    )
    if ret.returncode != 0:
        print("   ⚠️  Grafo não gerado (veja erro acima)")

    # 2. Criar/atualizar memory/RESUMO.md
    resumo = rag_dir / 'memory' / 'RESUMO.md'

    # Ler stats do grafo (pode já ter sido gerado)
    graph_file = rag_dir / 'graph' / 'graph.json'
    graph_nodes, graph_stats_early = [], {}
    if graph_file.exists():
        try:
            g = json.loads(graph_file.read_text())
            graph_nodes = g.get('nodes', [])
            graph_stats_early = g.get('stats', {})
        except Exception:
            pass

    if not resumo.exists():
        print("\n🔍 Analisando projeto para gerar memory/RESUMO.md...")
        info = analyze_project(project_path)
        content = build_resumo(name, info, graph_stats_early, graph_nodes, project_path)
        resumo.write_text(content)
        print(f"   Stack detectada: {', '.join(info['stack'][:4]) or '(vazia)'}")
        print(f"   → {resumo}")
    else:
        # Atualiza apenas o bloco de Stats para refletir o sync atual
        import re
        existing = resumo.read_text()
        stats_block = (
            f"## Stats (último sync)\n\n"
            f"- Arquivos: {graph_stats_early.get('files', 0)}\n"
            f"- Funções:  {graph_stats_early.get('functions', 0)}\n"
            f"- Classes:  {graph_stats_early.get('classes', 0)}\n"
            f"- Arestas:  {graph_stats_early.get('edges', 0)}\n"
        )
        if '## Stats' in existing:
            existing = re.sub(
                r'## Stats.*?(?=\n## |\Z)',
                stats_block,
                existing,
                flags=re.DOTALL,
            )
        else:
            existing = existing.rstrip() + '\n\n' + stats_block

        # Adicionar ou atualizar o comentário com o caminho do projeto
        if project_path:
            project_comment = f'<!-- RAG_PROJECT_PATH: {project_path.resolve()} -->'
            # Remover comentário antigo se houver
            existing = re.sub(r'\n*<!-- RAG_PROJECT_PATH: .+? -->\n*', '', existing)
            # Adicionar novo comentário no final
            existing = existing.rstrip() + '\n\n' + project_comment

        resumo.write_text(existing)
        print(f"\n📝 memory/RESUMO.md atualizado (stats do sync)")

    # 3. Registrar no log de atividade
    log_file = rag_dir / 'logs' / 'activity.md'
    entry = f"\n## {datetime.now().strftime('%Y-%m-%d %H:%M')}\n- Sync executado\n"

    # Reusar stats já lidas no passo 2
    stats = graph_stats_early
    if stats:
        entry += f"- Grafo: {stats.get('files', 0)} arquivos, {stats.get('functions', 0)} funções, {stats.get('classes', 0)} classes, {stats.get('edges', 0)} arestas\n"

    if not log_file.exists():
        log_file.write_text(f"# Activity Log - {name}\n")
    log_file.write_text(log_file.read_text() + entry)

    # 4. Criar/atualizar log diário
    create_daily_log(rag_dir, name, stats)

    # 5. Atualizar projects.json raiz
    update_projects_index(name, rag_dir)

    # 6. Atualizar CLAUDE.md no projeto real
    update_claude_md(project_path, name)

    print(f"\n✅ {name} sincronizado com sucesso!")
    print(f"   graph/graph.json  → grafo do código")
    print(f"   memory/RESUMO.md  → contexto para Claude")
    print(f"   logs/activity.md  → histórico de syncs")


def create_daily_log(rag_dir: Path, name: str, stats: dict):
    """Cria ou atualiza o log diário em logs/YYYY-MM-DD.md."""
    today = datetime.now().strftime('%Y-%m-%d')
    now   = datetime.now().strftime('%H:%M')
    daily = rag_dir / 'logs' / f'{today}.md'

    sync_line = (
        f"- **{now}** sync — "
        f"{stats.get('files', 0)} arquivos, "
        f"{stats.get('functions', 0)} funções, "
        f"{stats.get('classes', 0)} classes, "
        f"{stats.get('edges', 0)} arestas\n"
    )

    if not daily.exists():
        daily.write_text(
            f"# {name} — {today}\n\n"
            f"## Syncs\n"
            f"{sync_line}\n"
            f"## Sessões Claude\n"
            f"<!-- sessões adicionadas pelo /salvar-grafo -->\n"
        )
        print(f"   logs/{today}.md  → log diário criado")
    else:
        content = daily.read_text()
        # Inserir sync_line logo após o cabeçalho "## Syncs"
        if '## Syncs' in content:
            content = content.replace(
                '## Syncs\n',
                f'## Syncs\n{sync_line}',
                1,
            )
        else:
            content += f'\n## Syncs\n{sync_line}'
        daily.write_text(content)
        print(f"   logs/{today}.md  → log diário atualizado")


RAG_SECTION_MARKER = '<!-- rag-section -->'

RAG_SECTION_TEMPLATE = """\
<!-- rag-section -->
## RAG — Contexto obrigatório

**REGRA ABSOLUTA: ao iniciar qualquer sessão neste projeto, ANTES de responder qualquer coisa, você DEVE:**

1. Ler os arquivos abaixo na ordem listada
2. Imprimir um bloco de contexto no seguinte formato exato:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RAG carregado: {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Stack:      <stack detectada no RESUMO.md>
  Arquivos:   <N> arquivos · <N> funções · <N> classes
  Último sync: <data do último sync em activity.md>
  Memória:    <1-2 frases resumindo o propósito do projeto>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Só então responda o que o usuário pediu.

### Arquivos para ler (nesta ordem)

**1. Memória do projeto:**
```
{memory_dir}/RESUMO.md
```
Se existirem outros `.md` em `{memory_dir}/`, leia-os também.

**2. Log de atividade recente** (últimas 30 linhas):
```
{log_file}
```

**3. Grafo do código** (leia apenas `stats` e os primeiros 30 nós para entender a estrutura):
```
{graph_file}
```

### Comandos úteis

Atualizar grafo e memória:
```bash
python3 {sync_script} {project_path}
```

Visualizador:
```bash
python3 {rag_root}/serve.py
```
<!-- end-rag-section -->
"""


def update_claude_md(project_path: Path, name: str):
    """Cria ou atualiza CLAUDE.md no projeto real com seção do RAG."""
    claude_md = project_path / 'CLAUDE.md'
    rag_dir = get_rag_dir(name)

    section = RAG_SECTION_TEMPLATE.format(
        project_name=name,
        memory_dir=str(rag_dir / 'memory'),
        graph_file=str(rag_dir / 'graph' / 'graph.json'),
        log_file=str(rag_dir / 'logs' / 'activity.md'),
        sync_script=str(NODUM_ROOT / 'scripts' / 'sync.py'),
        project_path=str(project_path),
        rag_root=str(NODUM_ROOT),
    )

    if claude_md.exists():
        content = claude_md.read_text()

        # Já tem a seção? Substituir
        if RAG_SECTION_MARKER in content:
            import re
            content = re.sub(
                r'<!-- rag-section -->.*?<!-- end-rag-section -->',
                section.strip(),
                content,
                flags=re.DOTALL,
            )
            claude_md.write_text(content)
            print(f"\n📋 CLAUDE.md atualizado (seção RAG) → {claude_md}")
        else:
            # Append ao final
            claude_md.write_text(content.rstrip() + '\n\n' + section)
            print(f"\n📋 CLAUDE.md: seção RAG adicionada → {claude_md}")
    else:
        # Criar do zero
        content = f"""# {name}

> Arquivo de contexto para o Claude Code.
> Gerado automaticamente pelo RAG sync. Edite as seções marcadas.

## Sobre este projeto

[Descreva o propósito do projeto aqui]

## Stack

[Liste as tecnologias principais]

## Como rodar

```bash
# Adicione os comandos para rodar o projeto
```

{section}"""
        claude_md.write_text(content)
        print(f"\n📋 CLAUDE.md criado → {claude_md}")


def update_projects_index(name: str, rag_dir: Path):
    """Atualizar o índice central de projetos."""
    index_file = RAG_ROOT / 'projects.json'

    if index_file.exists():
        index = json.loads(index_file.read_text())
    else:
        index = {'projects': {}}

    graph_file = rag_dir / 'graph' / 'graph.json'
    stats = {}
    if graph_file.exists():
        try:
            g = json.loads(graph_file.read_text())
            stats = g.get('stats', {})
        except:
            pass

    # Ler dependências do RESUMO.md
    deps = []
    resumo = rag_dir / 'memory' / 'RESUMO.md'
    if resumo.exists():
        content = resumo.read_text()
        import re
        for line in content.split('\n'):
            m = re.match(r'[-*]\s+\[(.+?)\]', line)
            if m and 'Depende de' not in content[max(0, content.index(line)-200):content.index(line)]:
                deps_section = False
            if 'Depende de' in line:
                deps_section = True
            if re.match(r'##\s', line) and 'Depende de' not in line:
                deps_section = False

    # Listar logs diários existentes
    import re as _re
    log_dates = sorted(
        [f.stem for f in (rag_dir / 'logs').glob('*.md')
         if _re.match(r'\d{4}-\d{2}-\d{2}', f.stem)],
        reverse=True,
    )

    # Recuperar o caminho real do projeto (se houver um CLAUDE.md injetado lá)
    # Procura no git config ou cria um marcador no RESUMO.md
    project_path_str = None
    resumo = rag_dir / 'memory' / 'RESUMO.md'
    if resumo.exists():
        content = resumo.read_text()
        import re as _re2
        m = _re2.search(r'\n<!-- RAG_PROJECT_PATH: (.+?) -->', content)
        if m:
            project_path_str = m.group(1)

    index['projects'][name] = {
        'name':       name,
        'rag_path':   str(rag_dir.relative_to(RAG_ROOT)),
        'project_path': project_path_str,  # caminho real do projeto (se detectado)
        'last_sync':  datetime.now().isoformat(),
        'stats':      stats,
        'log_dates':  log_dates,
    }

    index_file.write_text(json.dumps(index, indent=2, ensure_ascii=False))


def list_projects():
    index_file = RAG_ROOT / 'projects.json'
    if not index_file.exists():
        print("Nenhum projeto sincronizado ainda.")
        print("Execute: python3 sync.py /caminho/do/projeto")
        return

    index = json.loads(index_file.read_text())
    projects = index.get('projects', {})

    if not projects:
        print("Nenhum projeto encontrado.")
        return

    print(f"\n{'─' * 60}")
    print(f"  {'Projeto':<20} {'Último sync':<22} {'Files':>6} {'Fns':>6}")
    print(f"{'─' * 60}")
    for name, info in projects.items():
        sync_time = info.get('last_sync', 'nunca')[:16].replace('T', ' ')
        stats = info.get('stats', {})
        print(f"  {name:<20} {sync_time:<22} {stats.get('files', 0):>6} {stats.get('functions', 0):>6}")
    print(f"{'─' * 60}")
    print(f"\nVisualizar: python3 {NODUM_ROOT}/serve.py")


def status():
    list_projects()
    if not DATA_ROOT.exists():
        return
    for d in DATA_ROOT.iterdir():
        if d.is_dir() and not d.name.startswith('.'):
            graph = d / 'graph' / 'graph.json'
            memory = d / 'memory' / 'RESUMO.md'
            log = d / 'logs' / 'activity.md'
            print(f"\n{d.name}:")
            print(f"  graph.json:  {'✅' if graph.exists() else '❌'}")
            print(f"  RESUMO.md:   {'✅' if memory.exists() else '❌'}")
            print(f"  activity.md: {'✅' if log.exists() else '❌'}")


if __name__ == '__main__':
    args = sys.argv[1:]

    if '--list' in args:
        list_projects()
    elif '--status' in args:
        status()
    elif args:
        project_path = Path(args[0]).resolve()
        if not project_path.exists():
            print(f"❌ Caminho não encontrado: {project_path}")
            sys.exit(1)
        sync_project(project_path)
    else:
        # Usar CWD
        cwd = Path.cwd()
        if cwd == NODUM_ROOT or cwd == NODUM_ROOT / 'scripts':
            print("❌ Rode este script a partir do seu projeto real, não do nodum.")
            print(f"   Uso: python3 {NODUM_ROOT}/scripts/sync.py /caminho/do/projeto")
            sys.exit(1)
        sync_project(cwd)
