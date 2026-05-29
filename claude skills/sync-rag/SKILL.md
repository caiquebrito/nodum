---
name: sync-rag
description: "Run RAG sync script to update knowledge graph and project memory"
trigger: /sync-rag
---

# /sync-rag

Sincroniza o grafo de conhecimento e a memoria do projeto via RAG sync.

## Uso

```
/sync-rag
```

## O que este skill faz

1. Executa o script `sync.py` que analisa o codigo fonte
2. Atualiza o grafo em `/Users/caiquebrito/Dev/Rag/vv-viaunica-android/graph/graph.json`
3. Atualiza a memoria em `/Users/caiquebrito/Dev/Rag/vv-viaunica-android/memory/RESUMO.md`
4. Atualiza o log de atividade em `/Users/caiquebrito/Dev/Rag/vv-viaunica-android/logs/activity.md`

## Passos

### 1. Executar sync

```bash
python3 /Users/caiquebrito/Dev/Rag/scripts/sync.py /Users/caiquebrito/Documents/Repositories/viaunica-high-level/vv-viaunica-android
```

### 2. Reportar resultado

Mostrar as estatisticas atualizadas do grafo (arquivos, funcoes, classes, arestas).

Se falhar, verificar:
- Python3 instalado
- Script `sync.py` existe no caminho esperado
- Repositorio Android acessivel
