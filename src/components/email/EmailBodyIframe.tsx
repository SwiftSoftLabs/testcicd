"use client";

import React, { useEffect, useRef, useState } from "react";

const IFRAME_SANDBOX =
  "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/**
 * Appended after message HTML so newsletter &lt;style&gt; blocks cannot paint the
 * canvas white. !important only on html/body defaults; links and blocks stay soft.
 */
const EMAIL_IFRAME_DARK_CSS = `
html { color-scheme: dark !important; }
body {
  margin: 0 !important;
  padding: 12px 14px !important;
  background-color: #0d1117 !important;
  color: #f0f6fc !important;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
}
a { color: #58a6ff; }
blockquote {
  border-left: 3px solid #30363d;
  margin: 0.5em 0;
  padding-left: 1em;
  color: #8b949e;
}
pre, code { background: #161b22; color: #e6edf3; }
img { max-width: 100%; height: auto; }
table { color: inherit; }
`;

function buildSrcDoc(sanitizedBodyFragment: string): string {
  const safe = sanitizedBodyFragment.replace(/<\/script/gi, "<\\/script");
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="color-scheme" content="dark"/>
<base target="_blank"/>
</head><body>${safe}<style>${EMAIL_IFRAME_DARK_CSS}</style></body></html>`;
}

type Props = {
  html: string;
};

/**
 * Renders provider email HTML in an isolated document so global app CSS does not
 * override the sender's layout, and embedded &lt;style&gt; blocks apply as intended.
 * The iframe document is forced to dark mode (matches app dark tokens); inline
 * colors in the message can still override where the sender specified them.
 */
export function EmailBodyIframe({ html }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(280);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const applyHeight = () => {
      const body = iframe.contentDocument?.body;
      if (!body) return;
      const h = Math.ceil(body.scrollHeight) + 16;
      setHeight(Math.max(120, Math.min(h, 14_000)));
    };

    const onLoad = () => {
      applyHeight();
      const body = iframe.contentDocument?.body;
      if (!body) return;
      const ro = new ResizeObserver(applyHeight);
      ro.observe(body);
      (iframe as HTMLIFrameElement & { __emailRo?: ResizeObserver }).__emailRo =
        ro;
    };

    iframe.addEventListener("load", onLoad);
    iframe.srcdoc = buildSrcDoc(html);

    return () => {
      iframe.removeEventListener("load", onLoad);
      const ro = (iframe as HTMLIFrameElement & { __emailRo?: ResizeObserver })
        .__emailRo;
      ro?.disconnect();
      delete (iframe as HTMLIFrameElement & { __emailRo?: ResizeObserver })
        .__emailRo;
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Email message"
      sandbox={IFRAME_SANDBOX}
      className="w-full min-h-[120px] border-0 bg-[#0d1117] block text-white!"
      style={{ height }}
    />
  );
}
