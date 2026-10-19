# FixFlix — Website

Landing page and waitlist for FixFlix, hosted on GitHub Pages; sign-ups are
stored in Supabase through four guarded database functions.

- Setup and how to read the numbers: [docs/demand-test.md](docs/demand-test.md)
- Database and its security rules: [supabase/schema.sql](supabase/schema.sql)
- Attack tests for those rules: `supabase/tests/run.sh`

```bash
npm install
npm run dev    # http://localhost:5173
npm test
```
