import React, { useState } from "react";

interface ScheduleModalProps {
  onSchedule: (delayMs: number) => void;
  onClose: () => void;
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  onSchedule,
  onClose,
}) => {
  const [minutes, setMinutes] = useState(5);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-dark border border-border-dark rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-base font-bold text-white mb-2">
          Schedule Message
        </h3>
        <p className="text-xs text-text-secondary mb-4">
          Message will be sent automatically from your browser. (Keep tab open)
        </p>
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">
              Delay (Minutes)
            </label>
            <input
              type="number"
              min="1"
              value={minutes}
              onChange={(e) => setMinutes(parseInt(e.target.value) || 1)}
              className="w-full mt-1.5 bg-background-dark border border-border-dark rounded-xl text-white text-sm px-4 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => {
                onSchedule(minutes * 60000);
                onClose();
              }}
              className="cursor-pointer flex-1 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:bg-blue-600 transition-all"
            >
              Schedule
            </button>
            <button
              onClick={onClose}
              className="cursor-pointer flex-1 py-2.5 bg-white/5 text-text-secondary rounded-xl font-bold text-sm hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
