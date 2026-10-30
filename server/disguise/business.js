export const BUSINESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Northgate Advisory — Operations &amp; Compliance Consulting</title>
<style>
  :root { --bg:#ffffff; --fg:#1c2430; --muted:#5d6b7d; --brand:#0f4c81; --line:#dde4ec; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--fg); font:16px/1.65 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header { border-bottom:1px solid var(--line); }
  .nav { max-width:960px; margin:0 auto; padding:20px 24px; display:flex; align-items:center; justify-content:space-between; }
  .logo { font-weight:700; color:var(--brand); letter-spacing:-0.01em; font-size:1.05rem; }
  nav a { margin-left:24px; color:var(--muted); text-decoration:none; font-size:0.95rem; }
  .hero { background:linear-gradient(180deg,#f4f7fb,#ffffff); border-bottom:1px solid var(--line); }
  .hero-in { max-width:960px; margin:0 auto; padding:72px 24px; }
  .hero h1 { font-size:2.1rem; line-height:1.25; letter-spacing:-0.02em; max-width:640px; }
  .hero p { margin-top:16px; color:var(--muted); max-width:560px; }
  .btn { display:inline-block; margin-top:24px; background:var(--brand); color:#fff; padding:10px 22px; border-radius:6px; text-decoration:none; font-weight:600; font-size:0.95rem; }
  .cols { max-width:960px; margin:0 auto; padding:56px 24px; display:grid; grid-template-columns:repeat(3,1fr); gap:32px; }
  .col h3 { font-size:1rem; margin-bottom:8px; color:var(--brand); }
  .col p { color:var(--muted); font-size:0.95rem; }
  footer { border-top:1px solid var(--line); }
  .foot { max-width:960px; margin:0 auto; padding:28px 24px; color:var(--muted); font-size:0.85rem; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
  @media (max-width:720px){ .cols{grid-template-columns:1fr} }
</style>
</head>
<body>
<header>
  <div class="nav">
    <div class="logo">Northgate Advisory</div>
    <nav><a href="#">Services</a><a href="#">Sectors</a><a href="#">Insights</a><a href="#">Contact</a></nav>
  </div>
</header>
<section class="hero">
  <div class="hero-in">
    <h1>Practical compliance and operations support for growing companies.</h1>
    <p>We help finance and logistics teams keep audits boring, documentation
    current, and regulators satisfied — without hiring a full department.</p>
    <a class="btn" href="#">Request a consultation</a>
  </div>
</section>
<div class="cols">
  <div class="col"><h3>Regulatory readiness</h3><p>Gap assessments, control mapping, and audit preparation aligned to the frameworks your customers actually ask about.</p></div>
  <div class="col"><h3>Process design</h3><p>Documented, repeatable workflows for onboarding, vendor review, and incident handling that teams follow because they work.</p></div>
  <div class="col"><h3>Ongoing support</h3><p>Retained advisory hours for questions that do not justify a project — answers within one business day.</p></div>
</div>
<footer>
  <div class="foot"><span>&copy; 2026 Northgate Advisory Ltd.</span><span>Registered in England &amp; Wales &middot; Privacy &middot; Terms</span></div>
</footer>
</body>
</html>`;
