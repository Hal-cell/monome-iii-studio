/**
 * Trigger a browser download of `content` as a file named `name`.
 * No external dependencies; just creates a Blob URL, attaches an
 * invisible anchor, clicks it, and revokes the URL.
 */
export function downloadText(name: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer the revoke to give the click a chance to begin downloading.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
