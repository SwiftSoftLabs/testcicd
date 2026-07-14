"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

interface FilePreviewModalProps {
  onClose: () => void;
  fileId: string;
  fileName: string;
  fileType: string;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "image"; objectUrl: string }
  | { status: "pdf"; objectUrl: string }
  | { status: "docx"; html: string }
  | { status: "text"; content: string }
  | { status: "markdown"; content: string }
  | { status: "no-preview" };

function fileIcon(type: string): string {
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "picture_as_pdf";
  if (type === "application/msword" || type.includes("wordprocessingml"))
    return "description";
  if (type === "application/json") return "data_object";
  if (type.includes("markdown")) return "description";
  if (type === "text/csv") return "table_chart";
  return "article";
}

function humanType(type: string): string {
  if (type.startsWith("image/")) return "Image";
  if (type === "application/pdf") return "PDF Document";
  if (type === "application/msword") return "Word Document (.doc)";
  if (type.includes("wordprocessingml")) return "Word Document (.docx)";
  if (type === "application/json") return "JSON";
  if (type.includes("markdown")) return "Markdown";
  if (type === "text/csv") return "CSV";
  if (type === "text/plain") return "Text";
  return "File";
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  onClose,
  fileId,
  fileName,
  fileType,
}) => {
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const revokeUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    const load = async () => {
      setPreview({ status: "loading" });
      try {
        const res = await authenticatedFetch(`/api/files/${fileId}/download`);
        if (!res.ok) throw new Error("Failed to fetch file");
        if (cancelled) return;

        const blob = await res.blob();
        if (cancelled) return;

        if (fileType.startsWith("image/")) {
          revokeUrl();
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setPreview({ status: "image", objectUrl: url });
          return;
        }

        if (fileType === "application/pdf") {
          revokeUrl();
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setPreview({ status: "pdf", objectUrl: url });
          return;
        }

        if (fileType.includes("wordprocessingml")) {
          const arrayBuffer = await blob.arrayBuffer();
          if (cancelled) return;
          const mammoth = await import("mammoth");
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (cancelled) return;
          const sanitizeHtml = (await import("sanitize-html")).default;
          const clean = sanitizeHtml(result.value, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat([
              "img",
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
            ]),
            allowedAttributes: {
              "*": ["style", "class"],
              a: ["href", "target"],
              img: ["src", "alt"],
            },
          });
          setPreview({ status: "docx", html: clean });
          return;
        }

        if (fileType === "application/msword") {
          setPreview({ status: "no-preview" });
          return;
        }

        if (fileType.includes("markdown") || fileType === "text/x-markdown") {
          const text = await blob.text();
          if (cancelled) return;
          setPreview({ status: "markdown", content: text });
          return;
        }

        if (fileType.startsWith("text/") || fileType === "application/json") {
          const text = await blob.text();
          if (cancelled) return;
          setPreview({ status: "text", content: text });
          return;
        }

        setPreview({ status: "no-preview" });
      } catch (e) {
        if (!cancelled) {
          setPreview({ status: "error", message: (e as Error).message });
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      revokeUrl();
    };
  }, [fileId, fileType]);

  const handleDownload = () => {
    window.open(`/api/files/${fileId}/download`, "_blank");
  };

  const renderContent = () => {
    switch (preview.status) {
      case "loading":
        return (
          <div className="flex flex-1 items-center justify-center gap-3 text-text-secondary">
            <span className="material-symbols-outlined animate-spin text-2xl">
              progress_activity
            </span>
            <span className="text-sm">Loading preview…</span>
          </div>
        );
      case "error":
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-6">
            <span className="material-symbols-outlined text-4xl text-red-400">
              error
            </span>
            <p className="text-sm text-text-secondary">{preview.message}</p>
            <button
              onClick={handleDownload}
              className="cursor-pointer flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <span className="material-symbols-outlined text-base">
                download
              </span>
              Download file
            </button>
          </div>
        );
      case "image":
        return (
          <div className="flex flex-1 items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.objectUrl}
              alt={fileName}
              className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-lg"
            />
          </div>
        );
      case "pdf":
        return (
          <iframe
            src={preview.objectUrl}
            className="flex-1 w-full border-0"
            style={{ minHeight: "70vh" }}
            title={fileName}
          />
        );
      case "docx":
        return (
          <div className="flex-1 overflow-auto p-6">
            <style>{`
                            .docx-preview p { margin-bottom: 0.75rem; line-height: 1.6; }
                            .docx-preview h1, .docx-preview h2, .docx-preview h3,
                            .docx-preview h4, .docx-preview h5, .docx-preview h6 {
                                font-weight: 600; margin-bottom: 0.5rem; margin-top: 1rem;
                                color: var(--text-primary);
                            }
                            .docx-preview h1 { font-size: 1.5rem; }
                            .docx-preview h2 { font-size: 1.25rem; }
                            .docx-preview h3 { font-size: 1.1rem; }
                            .docx-preview ul, .docx-preview ol { padding-left: 1.5rem; margin-bottom: 0.75rem; }
                            .docx-preview ul { list-style-type: disc; }
                            .docx-preview ol { list-style-type: decimal; }
                            .docx-preview li { margin-bottom: 0.25rem; }
                            .docx-preview table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
                            .docx-preview td, .docx-preview th {
                                border: 1px solid var(--border-color); padding: 0.5rem 0.75rem;
                            }
                            .docx-preview th { background: var(--bg-highlight); font-weight: 600; }
                            .docx-preview strong { font-weight: 600; }
                            .docx-preview em { font-style: italic; }
                            .docx-preview a { color: var(--color-primary); text-decoration: underline; }
                        `}</style>
            <div
              className="docx-preview text-sm text-text-primary max-w-none"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </div>
        );
      case "markdown":
        return (
          <div className="flex-1 overflow-auto p-6">
            <div className="text-sm text-text-secondary leading-relaxed max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-3">{children}</p>,
                  h1: ({ children }) => (
                    <h1 className="text-xl font-bold mb-3 mt-4 text-text-primary">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold mb-2 mt-4 text-text-primary">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-semibold mb-2 mt-3 text-text-primary">
                      {children}
                    </h3>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc pl-5 mb-3">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-5 mb-3">{children}</ol>
                  ),
                  li: ({ children }) => <li className="mb-1">{children}</li>,
                  a: ({ children, ...props }) => (
                    <a
                      className="text-accent hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      {...props}
                    >
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-accent pl-3 my-2 text-text-secondary/80 italic">
                      {children}
                    </blockquote>
                  ),
                  code: ({ children, className }) => {
                    const isBlock = className?.startsWith("language-");
                    return isBlock ? (
                      <code className="block bg-bg-main rounded-md p-3 text-sm font-mono overflow-x-auto mb-3">
                        {children}
                      </code>
                    ) : (
                      <code className="bg-white/10 px-1 py-0.5 rounded text-xs text-pink-400 font-mono">
                        {children}
                      </code>
                    );
                  },
                  pre: ({ children }) => <pre className="mb-3">{children}</pre>,
                }}
              >
                {preview.content}
              </ReactMarkdown>
            </div>
          </div>
        );
      case "text":
        return (
          <div className="flex-1 overflow-auto p-6">
            <pre className="whitespace-pre-wrap break-all text-sm text-text-secondary font-mono leading-relaxed">
              {preview.content}
            </pre>
          </div>
        );
      case "no-preview":
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center px-6">
            <span className="material-symbols-outlined text-5xl text-text-secondary/40">
              {fileIcon(fileType)}
            </span>
            <div>
              <p className="text-sm font-medium text-text-primary">
                Preview not available
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {fileType === "application/msword"
                  ? "Old .doc format requires a desktop application to view."
                  : "Download the file to view it in your preferred application."}
              </p>
            </div>
            <button
              onClick={handleDownload}
              className="cursor-pointer flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              <span className="material-symbols-outlined text-base">
                download
              </span>
              Download file
            </button>
          </div>
        );
    }
  };

  return (
    <div
      className="flex w-full max-w-4xl flex-col rounded-xl border border-border bg-bg-surface shadow-2xl"
      style={{ maxHeight: "90vh" }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <span className="material-symbols-outlined text-xl text-text-secondary shrink-0">
          {fileIcon(fileType)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {fileName}
          </p>
          <p className="text-xs text-text-secondary">{humanType(fileType)}</p>
        </div>
        <button
          onClick={handleDownload}
          className="cursor-pointer p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Download"
        >
          <span className="material-symbols-outlined text-base">download</span>
        </button>
        <button
          onClick={onClose}
          className="cursor-pointer p-1.5 rounded-md hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          title="Close"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      {/* Content */}
      <div
        className="flex flex-1 flex-col overflow-hidden min-h-0"
        style={{ minHeight: "400px" }}
      >
        {renderContent()}
      </div>
    </div>
  );
};

export default FilePreviewModal;
