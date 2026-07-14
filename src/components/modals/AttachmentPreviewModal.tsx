"use client";

import React, { useRef, useState } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";

export interface AttachmentPreviewModalProps {
  onClose: () => void;
  url: string;
  downloadUrl?: string;
  name: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

const AttachmentPreviewModal: React.FC<AttachmentPreviewModalProps> = ({
  onClose,
  url,
  downloadUrl: downloadUrlProp,
  name,
}) => {
  const downloadUrl = downloadUrlProp ?? url;
  const [zoom, setZoom] = useState(1);
  const modalRef = useRef<HTMLDivElement>(null);
  useClickOutside(modalRef, onClose);

  return (
    <div
      ref={modalRef}
      className="flex max-w-[90vw] max-h-[90vh] flex-col items-center gap-3"
    >
      <div className="flex w-full max-w-[90vw] items-center justify-between gap-4">
        <p className="truncate text-sm font-medium text-white/80">{name}</p>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
              disabled={zoom <= MIN_ZOOM}
              className="cursor-pointer flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              aria-label="Zoom out"
            >
              <span className="material-symbols-outlined text-[18px]">zoom_out</span>
            </button>
            <span className="w-10 text-center text-xs font-bold text-white/70">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
              disabled={zoom >= MAX_ZOOM}
              className="cursor-pointer flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
              aria-label="Zoom in"
            >
              <span className="material-symbols-outlined text-[18px]">zoom_in</span>
            </button>
          </div>
          <a
            href={downloadUrl}
            download={name}
            className="cursor-pointer flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20"
            title="Download"
            aria-label="Download"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-white/70 transition-colors hover:text-white"
            aria-label="Close preview"
          >
            <span className="material-symbols-outlined text-2xl">close</span>
          </button>
        </div>
      </div>

      <div className="max-h-[75vh] max-w-[90vw] overflow-auto rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
          className="block max-h-[75vh] max-w-[90vw] object-contain rounded-xl shadow-2xl transition-transform duration-150"
        />
      </div>
    </div>
  );
};

export default AttachmentPreviewModal;
