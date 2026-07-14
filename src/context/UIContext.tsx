"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ModalProps = Record<string, unknown> | null;

interface ModalEntry {
  instanceId: string;
  id: string;
  props: ModalProps;
}

interface UIContextType {
  modalStack: ModalEntry[];
  activeModal: string | null;
  openModal: (id: string, props?: ModalProps) => string;
  closeModal: () => void;
  updateModalProps: (props: ModalProps, instanceId?: string) => void;
  modalProps: ModalProps;
  toasts: Toast[];
  addToast: (
    message: string,
    type: "success" | "error" | "warning" | "info",
    action?: { label: string; onClick: () => void },
  ) => void;
  removeToast: (id: string) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  globalSearchOpen: boolean;
  globalSearchQuery: string;
  openGlobalSearch: (query?: string) => void;
  closeGlobalSearch: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  action?: { label: string; onClick: () => void };
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [modalStack, setModalStack] = useState<ModalEntry[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");

  const openGlobalSearch = useCallback((query?: string) => {
    setGlobalSearchQuery(typeof query === "string" ? query.trim() : "");
    setGlobalSearchOpen(true);
  }, []);

  const closeGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(false);
    setGlobalSearchQuery("");
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: "success" | "error" | "warning" | "info") => {
      const id = Math.random().toString(36).substr(2, 9);
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        removeToast(id);
      }, 5000);
    },
    [removeToast],
  );

  const openModal = useCallback((id: string, props?: ModalProps) => {
    const instanceId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setModalStack((prev) => [
      ...prev,
      {
        instanceId,
        id,
        props: props ?? null,
      },
    ]);
    return instanceId;
  }, []);

  const closeModal = useCallback(() => {
    setModalStack((prev) => prev.slice(0, -1));
  }, []);

  const updateModalProps = useCallback(
    (props: ModalProps, instanceId?: string) => {
      setModalStack((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const targetIndex = instanceId
          ? next.findIndex((entry) => entry.instanceId === instanceId)
          : next.length - 1;

        if (targetIndex === -1) return prev;

        const target = next[targetIndex];
        next[targetIndex] = {
          ...target,
          props: {
            ...(target.props ?? {}),
            ...(props ?? {}),
          },
        };
        return next;
      });
    },
    [],
  );

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const value = useMemo<UIContextType>(() => {
    const activeModal = modalStack[modalStack.length - 1]?.id ?? null;
    const modalProps = modalStack[modalStack.length - 1]?.props ?? null;
    return {
      modalStack,
      activeModal,
      openModal,
      closeModal,
      updateModalProps,
      modalProps,
      toasts,
      addToast,
      removeToast,
      isSidebarOpen,
      toggleSidebar,
      setSidebarOpen: setIsSidebarOpen,
      globalSearchOpen,
      globalSearchQuery,
      openGlobalSearch,
      closeGlobalSearch,
    };
  }, [
    modalStack,
    openModal,
    closeModal,
    updateModalProps,
    toasts,
    addToast,
    removeToast,
    isSidebarOpen,
    toggleSidebar,
    globalSearchOpen,
    globalSearchQuery,
    openGlobalSearch,
    closeGlobalSearch,
  ]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};

export const useUIContext = () => {
  const context = useContext(UIContext);
  if (!context)
    throw new Error("useUIContext must be used within a UIProvider");
  return context;
};
