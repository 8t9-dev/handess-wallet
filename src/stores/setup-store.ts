import { create } from 'zustand';

interface SetupStore {
  isOpen: boolean;
  checked: boolean;
  checkFirstRun: () => Promise<void>;
  openWizard: () => void;
  closeWizard: () => void;
}

export const useSetupStore = create<SetupStore>((set, get) => ({
  isOpen: false,
  checked: false,

  checkFirstRun: async () => {
    if (get().checked) return;
    set({ checked: true });
    if (!window.api?.setup) return;
    try {
      const status = await window.api.setup.getStatus();
      if (!status.completed) set({ isOpen: true });
    } catch {
      // If detection fails, leave the app usable via Settings.
    }
  },

  openWizard: () => set({ isOpen: true }),
  closeWizard: () => set({ isOpen: false }),
}));
