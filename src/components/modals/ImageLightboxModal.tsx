'use client';

import React, { useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';

export interface ImageLightboxModalProps {
    onClose: () => void;
    url: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({ onClose, url }) => {
    const [zoom, setZoom] = useState(1);
    const modalRef = useRef<HTMLDivElement>(null);
    useClickOutside(modalRef, onClose);

    return (
        <div ref={modalRef} className="flex flex-col items-center gap-3 max-w-[90vw]">
            <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setZoom(z => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
                        disabled={zoom <= MIN_ZOOM}
                        className="cursor-pointer size-8 rounded-lg bg-white/10 text-white flex items-center justify-center hover:bg-white/20 disabled:opacity-40 transition-colors"
                        aria-label="Zoom out"
                    >
                        <span className="material-symbols-outlined text-[18px]">zoom_out</span>
                    </button>
                    <span className="text-xs font-bold text-white/70 w-10 text-center">
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        onClick={() => setZoom(z => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
                        disabled={zoom >= MAX_ZOOM}
                        className="cursor-pointer size-8 rounded-lg bg-white/10 text-white flex items-center justify-center hover:bg-white/20 disabled:opacity-40 transition-colors"
                        aria-label="Zoom in"
                    >
                        <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                    </button>
                    <button
                        onClick={() => setZoom(1)}
                        className="cursor-pointer text-xs font-bold text-white/50 hover:text-white transition-colors px-2"
                        aria-label="Reset zoom"
                    >
                        Reset
                    </button>
                </div>
                <button
                    onClick={onClose}
                    className="cursor-pointer text-white/70 hover:text-white transition-colors"
                    aria-label="Close"
                >
                    <span className="material-symbols-outlined text-2xl">close</span>
                </button>
            </div>

            <div className="overflow-auto max-h-[80vh] max-w-[90vw] rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={url}
                    alt="Comment image"
                    style={{ '--zoom': zoom } as React.CSSProperties}
                    className="max-h-[80vh] max-w-[90vw] object-contain rounded-xl shadow-2xl block scale-(--zoom) origin-top-left transition-transform duration-150 ease-in"
                />
            </div>
        </div>
    );
};

export default ImageLightboxModal;
