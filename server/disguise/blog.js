export const BLOG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Field Notes</title>
<style>
  :root { --bg:#faf9f6; --fg:#26221c; --muted:#8a8378; --rule:#e5e1d8; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font:17px/1.7 Georgia,"Times New Roman",serif; }
  .wrap { max-width:640px; margin:0 auto; padding:72px 24px; }
  header { margin-bottom:48px; }
  h1 { font-size:1.5rem; font-weight:400; letter-spacing:0.01em; }
  .sub { color:var(--muted); font-style:italic; margin-top:4px; }
  article { border-top:1px solid var(--rule); padding:28px 0; }
  article h2 { font-size:1.15rem; font-weight:600; margin-bottom:6px; }
  article .meta { color:var(--muted); font-size:0.85rem; font-family:-apple-system,"Segoe UI",sans-serif; }
  article p { margin-top:8px; }
  a { color:inherit; }
  footer { margin-top:48px; padding-top:16px; border-top:1px solid var(--rule); color:var(--muted); font-size:0.85rem; font-family:-apple-system,"Segoe UI",sans-serif; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Field Notes</h1>
    <div class="sub">occasional writing on systems, tooling, and the outdoors</div>
  </header>

  <article>
    <h2><a href="#">The boring case for runbooks</a></h2>
    <div class="meta">October 2026 &middot; ops</div>
    <p>Every incident postmortem I have written ends the same way: we knew what
    to do, we just did it out of order. Runbooks are not documentation, they are
    choreography.</p>
  </article>

  <article>
    <h2><a href="#">Reading old code so you do not have to</a></h2>
    <div class="meta">August 2026 &middot; maintenance</div>
    <p>I spent a week inside a decade-old service so you can skip the part
    where you grep for a function name and find eleven definitions.</p>
  </article>

  <article>
    <h2><a href="#">Water filters, ranked by weight per liter</a></h2>
    <div class="meta">June 2026 &middot; outdoors</div>
    <p>A completely unscientific comparison conducted over three weekends and
    roughly sixty liters of very questionable stream water.</p>
  </article>

  <footer> syndicated nowhere &middot; rss available on request </footer>
</div>
</body>
</html>`;
