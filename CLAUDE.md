# Claude Code — Project Memory

## After Making Changes

Always run lint and format before committing or finishing work:

```bash
npm run lint:fix
npm run format
```

## Output Style

- Do not wrap URLs/links in asterisks (`**`). Asterisks become part of the URL and break clickable links.
  - Bad: `**https://example.com**`
  - Good: `https://example.com`
