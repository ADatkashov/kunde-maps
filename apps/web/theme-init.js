/* Apply the saved theme before first paint to avoid a flash. External file (not inline) so the CSP can forbid inline scripts. */
try { var t = localStorage.getItem('kunde-theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (_) {}
