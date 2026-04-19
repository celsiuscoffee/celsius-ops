// Shift templates — the dropdown options used in the schedule grid.
// Named shifts per outlet + generic full-day.

export type ShiftTemplate = {
  id: string;
  label: string;
  start_time: string;  // "HH:MM"
  end_time: string;    // "HH:MM"
  break_minutes: number;
  // scope: 'all' = available everywhere, or specific outlet code
  outlets?: string[];  // undefined = all outlets
  color: string;       // tailwind class suffix, e.g. 'blue'
};

export const REST_DAY_ID = "rest_day";
export const LEAVE_ID = "on_leave";

export const SHIFT_TEMPLATES: ShiftTemplate[] = [
  // Generic (all outlets)
  {
    id: "full_day",
    label: "Full day (8h)",
    start_time: "09:00",
    end_time: "17:30",
    break_minutes: 30,
    color: "gray",
  },

  // Putrajaya/Conezion shifts
  {
    id: "putrajaya_morning",
    label: "Putrajaya Morning",
    start_time: "07:30",
    end_time: "15:30",
    break_minutes: 30,
    outlets: ["CC001"],
    color: "amber",
  },
  {
    id: "putrajaya_afternoon",
    label: "Putrajaya Afternoon",
    start_time: "15:30",
    end_time: "23:30",
    break_minutes: 30,
    outlets: ["CC001"],
    color: "indigo",
  },

  // Shah Alam shifts
  {
    id: "shah_alam_morning",
    label: "Shah Alam Morning",
    start_time: "07:30",
    end_time: "15:30",
    break_minutes: 30,
    outlets: ["CC002"],
    color: "amber",
  },
  {
    id: "shah_alam_afternoon_2",
    label: "Shah Alam Afternoon 2",
    start_time: "14:30",
    end_time: "23:30",
    break_minutes: 30,
    outlets: ["CC002"],
    color: "indigo",
  },

  // Cyberjaya/Tamarind shifts
  {
    id: "cyberjaya_morning",
    label: "Cyberjaya Morning",
    start_time: "07:30",
    end_time: "16:30",
    break_minutes: 30,
    outlets: ["CC003"],
    color: "amber",
  },
  {
    id: "cyberjaya_middle",
    label: "Cyberjaya Middle",
    start_time: "11:00",
    end_time: "20:00",
    break_minutes: 30,
    outlets: ["CC003"],
    color: "blue",
  },
  {
    id: "cyberjaya_closing",
    label: "Cyberjaya Closing",
    start_time: "14:30",
    end_time: "23:00",
    break_minutes: 30,
    outlets: ["CC003"],
    color: "indigo",
  },

  // Nilai shifts
  {
    id: "nilai_mon_thurs",
    label: "Nilai Mon-Thurs",
    start_time: "12:30",
    end_time: "22:30",
    break_minutes: 30,
    outlets: ["CF Nilai"],
    color: "purple",
  },
];

/** Find template by id, or null */
export function getTemplate(id: string): ShiftTemplate | null {
  return SHIFT_TEMPLATES.find((t) => t.id === id) || null;
}

/** Templates available for a given outlet code */
export function templatesForOutlet(outletCode: string): ShiftTemplate[] {
  return SHIFT_TEMPLATES.filter((t) => !t.outlets || t.outlets.includes(outletCode));
}

/** Compute working hours of a template (duration minus break) */
export function workingHours(t: ShiftTemplate): number {
  const [sh, sm] = t.start_time.split(":").map(Number);
  const [eh, em] = t.end_time.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const duration = (endMin - startMin) / 60;
  return Math.round((duration - t.break_minutes / 60) * 100) / 100;
}
