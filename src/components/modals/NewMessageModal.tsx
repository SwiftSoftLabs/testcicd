"use client";

import React, { useState, useRef } from "react";
import { useAppContext } from "@/context/AppContext";
import { useUIContext } from "@/context/UIContext";
import { useClickOutside } from "@/hooks/useClickOutside";

interface NewMessageModalProps {
  onClose: () => void;
}

const NewMessageModal: React.FC<NewMessageModalProps> = ({ onClose }) => {
  const { users, sendChatMessage } = useAppContext();
  const { addToast } = useUIContext();
  const modalRef = useRef<HTMLDivElement>(null);
  const [recipientId, setRecipientId] = useState("");
  const [content, setContent] = useState("");

  useClickOutside(modalRef, onClose);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !recipientId) return;

    if (sendChatMessage) {
      sendChatMessage(recipientId, content);
    }

    addToast("Message sent successfully!", "success");
    onClose();
  };

  return (
    <div
      ref={modalRef}
      className="max-w-md mx-auto bg-surface-dark border border-border-dark rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-200"
    >
      <div className="px-6 py-4 border-b border-border-dark flex items-center justify-between bg-white/[0.02]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">
            chat_bubble
          </span>
          New Message
        </h2>
        <button
          onClick={onClose}
          className="cursor-pointer text-text-secondary hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <form onSubmit={handleSend} className="p-6 space-y-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Recipient
          </label>
          <select
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-2.5 transition-all outline-none"
          >
            <option value="">Select a teammate...</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
            Message
          </label>
          <textarea
            autoFocus
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full bg-background-dark border-border-dark rounded-xl text-white text-sm focus:ring-1 focus:ring-primary focus:border-primary px-4 py-3 transition-all resize-none outline-none"
            placeholder="Type your message..."
          ></textarea>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-4 py-2 text-text-secondary text-sm font-bold hover:text-white transition-colors"
          >
            Discard
          </button>
          <button
            type="submit"
            disabled={!content.trim() || !recipientId}
            className="cursor-pointer px-8 py-2.5 bg-primary disabled:opacity-50 text-white text-sm font-black rounded-xl shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all flex items-center gap-2 active:scale-95"
          >
            Send{" "}
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewMessageModal;
