"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

interface ImageLightboxProps {
  src: string;
  alt: string;
  fileName: string;
  downloadUrl: string;
  onClose: () => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

export const ImageLightbox: React.FC<ImageLightboxProps> = ({
  src,
  alt,
  fileName,
  downloadUrl,
  onClose,
}) => {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, offsetX: 0, offsetY: 0 });
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(+(z + ZOOM_STEP).toFixed(2), MAX_ZOOM)),
    [],
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(+(z - ZOOM_STEP).toFixed(2), MIN_ZOOM)),
    [],
  );
  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-") zoomOut();
      else if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, zoomIn, zoomOut, resetView]);

  // Scroll-wheel zoom (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoomIn, zoomOut]);

  // Window-level drag tracking — clean regardless of where mouse is released
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const { mouseX, mouseY, offsetX, offsetY } = dragStartRef.current;
      setOffset({ x: offsetX + (e.clientX - mouseX), y: offsetY + (e.clientY - mouseY) });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging]);

  const handleImageMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // don't bubble to backdrop
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };

  if (!mounted) return null;

  const content = (
    // Outer div IS the backdrop — clicking dark area closes
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center select-none"
      style={{ background: "rgba(0,0,0,0.92)", cursor: isDragging ? "grabbing" : "default" }}
      onClick={onClose}
    >
      {/* Top bar — z-20 so it's always above image, stopPropagation so it doesn't close */}
      <div
        className="cursor-pointer absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-white/70 text-sm font-medium truncate max-w-[60vw]" title={fileName}>
          {fileName}
        </span>
        <button
          onClick={onClose}
          className="cursor-pointer p-2 hover:bg-white/10 rounded-full text-white/70 hover:text-white transition-colors"
          title="Close (Esc)"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </div>

      {/* Image — z-10, stopPropagation on click so clicking image doesn't close */}
      <div
        ref={containerRef}
        className="relative z-10 flex items-center justify-center pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onMouseDown={handleImageMouseDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.12s ease",
            cursor: isDragging ? "grabbing" : zoom > 1 ? "grab" : "zoom-in",
            maxWidth: "88vw",
            maxHeight: "80vh",
            objectFit: "contain",
            borderRadius: "12px",
            boxShadow: "0 25px 60px rgba(0,0,0,0.7)",
            pointerEvents: "auto",
          }}
            />
      </div>

      {/* Bottom controls — z-20, stopPropagation so clicks don't close */}
      <div
        className="cursor-pointer absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-2 px-4 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-2xl px-3 py-2 border border-white/10">
          <button
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="cursor-pointer p-1.5 hover:bg-white/15 rounded-lg text-white disabled:opacity-30 transition-colors"
            title="Zoom out (−)"
          >
            <span className="material-symbols-outlined text-[18px]">remove</span>
          </button>

          <button
            onClick={resetView}
            className="cursor-pointer px-2.5 py-1 hover:bg-white/15 rounded-lg text-white text-xs font-mono min-w-[52px] text-center transition-colors"
            title="Reset view (0)"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="cursor-pointer p-1.5 hover:bg-white/15 rounded-lg text-white disabled:opacity-30 transition-colors"
            title="Zoom in (+)"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
          </button>

          <div className="w-px h-5 bg-white/20 mx-1" />

          <a
            href={downloadUrl}
            download={fileName}
            className="cursor-pointer p-1.5 hover:bg-white/15 rounded-lg text-white/70 hover:text-white transition-colors"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
          </a>
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none">
        <span className="text-white/25 text-[10px]">
          Scroll or +/− to zoom · Drag to pan · Esc or click outside to close
        </span>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
