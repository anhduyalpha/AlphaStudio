# npm registry note

This archive has been normalized for installation on a personal Windows machine.

- `.npmrc` points to `https://registry.npmjs.org/`
- All `resolved` package URLs in `package-lock.json` also point to the public npm registry.

Recommended clean install from CMD:

```bat
taskkill /F /IM node.exe 2>nul
rmdir /S /Q node_modules 2>nul
npm cache verify
npm ci --no-audit --no-fund
npm run dev
```
