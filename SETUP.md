# Creating the repo (one-time)

1. Create the GitHub org **pangoljs** (github.com/organizations/plan).
2. Create an empty repo **pangoljs/pangol** (no README, no license — they are in this folder).
3. Push:

   ```bash
   cd pangol
   git init -b main
   git add .
   git commit -m "chore: initial spec, PoCs and v0.1 skeleton"
   git remote add origin git@github.com:pangoljs/pangol.git
   git push -u origin main
   ```

4. Repo settings:
   - Security → enable **Private vulnerability reporting**
   - Branches → protect `main` (require PR + the `ci` check)
   - Social preview → upload `docs/brand/pangol-logo.png`
   - Org avatar → `docs/brand/pangol-icon-512.png`
5. Reserve the npm names before announcing anything:

   ```bash
   npm login
   npm org create pangol            # gives you the @pangol scope (free plan is fine for public packages)
   cd packages/pangol && pnpm build && npm publish --access public   # publishes pangol@0.0.0 placeholder
   ```

6. Delete this file afterwards if you like.
