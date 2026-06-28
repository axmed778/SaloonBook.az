import { ArrowRight, Check, Clock, Scissors, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

const SERVICES = [
  { name: "Saç kəsimi", duration: "45 dəq", price: "20 ₼", icon: Scissors, selected: true },
  { name: "Manikür", duration: "60 dəq", price: "25 ₼", icon: Sparkles, selected: false },
];

const SLOTS = ["10:00", "11:30", "13:00", "14:30"];
const SELECTED_SLOT = "11:30";

/**
 * Static, on-brand mock of the public booking widget — used as the hero
 * "screenshot". Mirrors the seeded demostudio salon so it reads as real.
 */
export function BookingPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-frame backdrop-blur">
      {/* Faux browser chrome */}
      <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-border-strong" />
          <span className="h-3 w-3 rounded-full bg-border-strong" />
          <span className="h-3 w-3 rounded-full bg-border-strong" />
        </div>
        <div className="mx-auto hidden items-center rounded-md border border-border bg-background px-3 py-1 text-xs text-muted-foreground sm:flex">
          salonbook.az/demostudio
        </div>
      </div>

      {/* Widget body */}
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              Demo Beauty Studio
            </h3>
            <p className="text-xs text-muted-foreground">Onlayn qeydiyyat</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Açıqdır
          </span>
        </div>

        {/* Services */}
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Xidmət
          </p>
          {SERVICES.map((s) => (
            <div
              key={s.name}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3.5 py-3 transition-colors",
                s.selected ? "border-accent/50 bg-accent/10" : "border-border bg-muted",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md",
                    s.selected
                      ? "bg-accent/15 text-accent"
                      : "bg-card text-muted-foreground",
                  )}
                >
                  <s.icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-medium text-foreground">{s.name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" strokeWidth={2} />
                    {s.duration}
                  </p>
                </div>
              </div>
              <span className="text-sm font-medium text-foreground">{s.price}</span>
            </div>
          ))}
        </div>

        {/* Time slots */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Vaxt
            </p>
            <p className="text-xs text-muted-foreground">28 İyun, Şən</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {SLOTS.map((slot) => {
              const active = slot === SELECTED_SLOT;
              return (
                <span
                  key={slot}
                  className={cn(
                    "rounded-md border py-2 text-center text-sm transition-colors",
                    active
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {slot}
                </span>
              );
            })}
          </div>
        </div>

        {/* Confirm */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground">
              A
            </span>
            <span className="text-sm text-muted-foreground">
              Ayan <span className="text-faint-foreground">· Bərbər</span>
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground shadow-sm shadow-accent/20">
            <Check className="h-4 w-4" strokeWidth={2.5} />
            Təsdiqlə
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </span>
        </div>
      </div>
    </div>
  );
}
