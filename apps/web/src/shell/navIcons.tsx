import type { LucideIcon } from 'lucide-react';
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gavel,
  Home,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Mail,
  Megaphone,
  MessageSquareText,
  ScanLine,
  Send,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
  Zap,
} from 'lucide-react';

/**
 * Icons for sidebar entries. Kept apart from nav.ts so the navigation model stays plain data (the e2e helpers
 * import it in Node). Unknown ids fall back to a neutral icon rather than failing.
 */
const ICONS: Record<string, LucideIcon> = {
  // Core Admin domains
  command: Home,
  configuration: CalendarDays,
  people: Users,
  judging: Gavel,
  operations: Zap,
  communication: Mail,
  records: BarChart3,
  // Role pages
  home: LayoutDashboard,
  team: Users,
  submission: FileText,
  rounds: CalendarClock,
  updates: Megaphone,
  feedback: MessageSquareText,
  certificates: Award,
  judge: ClipboardList,
  briefing: BookOpen,
  practice: ListChecks,
  tasks: ClipboardCheck,
  checkin: ScanLine,
  issues: TriangleAlert,
  guidebook: BookOpen,
  support: Send,
  profile: UserRound,
  settings: Settings,
  more: LayoutGrid,
};

export function navIcon(id: string): LucideIcon {
  return ICONS[id] ?? LayoutDashboard;
}
