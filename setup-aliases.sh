#!/bin/bash
# Add this to your ~/.zshrc or ~/.bashrc to make 'nodum' command available

NODUM_PATH="/Users/caiquebrito/Documents/Repositories/nodum"

alias nodum="node $NODUM_PATH/packages/cli/dist/bin/nodum.js"
alias nodum-benchmark="cd $NODUM_PATH/benchmarks && node harness.ts"
alias nodum-build="cd $NODUM_PATH && npm run build"

echo "✅ Aliases installed!"
echo ""
echo "You can now use:"
echo "  nodum sync /path/to/project"
echo "  nodum status"
echo "  nodum serve"
echo "  nodum-benchmark [project-path]"
echo "  nodum-build"
