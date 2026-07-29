# @caiquebrito/nodum-server

## 2.11.0

### Patch Changes

- Updated dependencies [97f89ab]
- Updated dependencies [31d9c86]
  - @caiquebrito/nodum-core@2.11.0

## 2.10.0

### Patch Changes

- a68164b: Fixes a real path-traversal vulnerability in the `nodum serve` HTTP API: a URL-encoded `..%2F` project name could read `graph.json` files outside the intended `~/.nodum` data directory. Also fixes `nodum serve` binding to all network interfaces (`0.0.0.0`) by default with no authentication — it now binds to `127.0.0.1` by default; set `NODUM_HOST` to opt into a wider bind (a warning is printed when you do).

  Also fixes a viewer bug where a project name containing `+`, a space, or non-ASCII characters wasn't URL-encoded in one of its fetch calls.

  Second of four specs in the v2.10.0 batch.

- Updated dependencies [edbdbce]
- Updated dependencies [200cc79]
  - @caiquebrito/nodum-core@2.10.0

## 2.9.0

### Patch Changes

- Updated dependencies [88c2842]
- Updated dependencies [9864c49]
- Updated dependencies [1a65311]
  - @caiquebrito/nodum-core@2.9.0

## 2.8.0

### Patch Changes

- Updated dependencies [4134bf4]
  - @caiquebrito/nodum-core@2.8.0

## 2.7.0

### Patch Changes

- Updated dependencies [e9ad9fc]
- Updated dependencies [e129d4f]
- Updated dependencies [9b97d6f]
- Updated dependencies [384a549]
- Updated dependencies [265c38e]
- Updated dependencies [5397b91]
- Updated dependencies [f2de187]
- Updated dependencies [7a8d6b4]
- Updated dependencies [0d550d5]
- Updated dependencies [afa1ed2]
  - @caiquebrito/nodum-core@2.7.0

## 2.6.0

### Patch Changes

- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
- Updated dependencies [fb2299d]
  - @caiquebrito/nodum-core@2.6.0

## 2.5.0

### Patch Changes

- Updated dependencies [95fd195]
- Updated dependencies [902037f]
  - @caiquebrito/nodum-core@2.5.0

## 2.0.3

### Patch Changes

- 3395e22: Bump minimum supported Node.js version to 18 (Node 16 is end-of-life).
- Updated dependencies [3395e22]
- Updated dependencies [b32a4c0]
  - @caiquebrito/nodum-core@2.2.2
