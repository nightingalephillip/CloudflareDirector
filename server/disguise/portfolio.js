export const PORTFOLIO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alex Renn — Software Developer</title>
<style>
  :root { --bg:#0f1115; --fg:#d7dce3; --muted:#8b93a1; --accent:#5ea0ef; --card:#171a21; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  a { color:var(--accent); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .wrap { max-width:720px; margin:0 auto; padding:64px 24px; }
  h1 { font-size:1.9rem; font-weight:600; letter-spacing:-0.02em; }
  h2 { font-size:1.1rem; color:var(--muted); font-weight:500; margin:32px 0 12px; text-transform:uppercase; letter-spacing:0.08em; }
  p { margin:12px 0; color:var(--fg); }
  .tag { color:var(--muted); font-size:0.95rem; }
  .card { background:var(--card); border:1px solid #22262f; border-radius:10px; padding:18px 20px; margin:14px 0; }
  .card b { display:block; margin-bottom:4px; }
  .card span { color:var(--muted); font-size:0.92rem; }
  footer { margin-top:56px; color:var(--muted); font-size:0.85rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Alex Renn</h1>
  <p class="tag">Software developer — distributed systems &amp; web performance</p>
  <p>I build backend services and developer tooling. Currently interested in
  edge compute, caching strategies, and making CI pipelines less painful.
  Previously at two mid-size startups and one very large consultancy.</p>

  <h2>Projects</h2>
  <div class="card"><b>cargoload</b><span>Queue-based job runner with backpressure and retries. Go, Postgres.</span></div>
  <div class="card"><b>tidyspace</b><span>Disk usage explorer for the terminal. Rust, crossterm.</span></div>
  <div class="card"><b>formkit-lite</b><span>Dependency-free form validation for vanilla JS. 4kb gzipped.</span></div>

  <h2>Writing</h2>
  <p><a href="#">Notes on backpressure</a> — why most queue libraries get it wrong.</p>
  <p><a href="#">Cache keys are an API</a> — a short field guide.</p>

  <h2>Contact</h2>
  <p>hello@example.dev &middot; <a href="#">github/alexrenn</a></p>

  <footer>&copy; 2026 Alex Renn. Built by hand, no tracking.</footer>
</div>
</body>
</html>`;
