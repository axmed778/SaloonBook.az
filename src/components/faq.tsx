"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const FAQS = [
  {
    q: "SalonBook.az necə işləyir?",
    a: "Salonunuzu yaradın, xidmət, usta və iş saatlarını əlavə edin. Sizə şəxsi link verilir — onu Instagram bio və ya WhatsApp-da paylaşın. Müştərilər linkə daxil olub boş vaxt seçir və özləri qeydiyyatdan keçir.",
  },
  {
    q: "Müştərilər tətbiq yükləməlidirmi?",
    a: "Xeyr. Qeydiyyat səhifəsi adi bir veb linkdir — telefonda və ya kompüterdə brauzerdə açılır. Heç bir yükləmə və ya hesab tələb olunmur.",
  },
  {
    q: "WhatsApp xatırlatmaları necə işləyir?",
    a: "Rezervasiya təsdiqi və görüşdən əvvəl xatırlatma avtomatik göndərilir. Mesajlar fonda işləyən ayrıca xidmət vasitəsilə yollanır — ona görə qeydiyyatın özü heç vaxt gözləmir.",
  },
  {
    q: "İkiqat rezervasiyanın qarşısı necə alınır?",
    a: "Eyni usta üçün iki təsdiqlənmiş görüş heç vaxt üst-üstə düşə bilməz — bu, verilənlər bazası səviyyəsində təmin olunur. İki nəfər eyni anda eyni vaxtı seçsə belə, yalnız biri keçir.",
  },
  {
    q: "Pulsuz istifadə edə bilərəm?",
    a: "Bəli. Pulsuz planla 2 işçi və ayda 50 rezervasiyaya qədər. Dəvət kodu (EARLYBIRD) ilə Basic planı 3 ay tamamilə pulsuzdur.",
  },
  {
    q: "Ödəniş necə aparılır?",
    a: "Hazırda ödənişlər manualdır — planınızı seçirsiniz, biz aktivləşdiririk. Avtomatik onlayn ödəniş və depozitlər (no-show qoruması) Pro üçün hazırlanır.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mx-auto w-full max-w-3xl divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      {FAQS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-hover"
            >
              <span className="text-[15px] font-medium text-foreground">{item.q}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
                  isOpen && "rotate-180 text-accent",
                )}
                strokeWidth={2}
              />
            </button>
            <div
              className={cn(
                "grid transition-all duration-300 ease-out",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-[15px] leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
