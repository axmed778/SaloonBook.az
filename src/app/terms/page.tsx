import type { Metadata } from "next";
import { LegalShell, Section, P, Ul, Li } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "İstifadə Şərtləri — SalonBook.az",
  description: "SalonBook.az platformasından istifadə qaydaları və şərtləri.",
};

const CONTACT_WA = "+994 50 299 04 40";

export default function TermsPage() {
  return (
    <LegalShell title="İstifadə Şərtləri" updated="6 iyul 2026">
      <Section title="1. Xidmətin təsviri">
        <P>
          SalonBook.az salonlar, bərbərxanalar və klinikalar üçün onlayn qeydiyyat
          platformasıdır: müştərilər salonun səhifəsi vasitəsilə özləri görüş üçün yer
          ayırır, salon isə təqvim üzərindən görüşləri idarə edir və WhatsApp bildirişləri
          alır/göndərir. Platformadan istifadə etməklə bu şərtlərlə razılaşırsınız.
        </P>
      </Section>

      <Section title="2. Hesab və məsuliyyət">
        <Ul>
          <Li>Hesab yaratmaq üçün düzgün və aktual məlumat təqdim etməlisiniz;</Li>
          <Li>Hesabınızın giriş məlumatlarının qorunmasına görə siz məsuliyyət daşıyırsınız;</Li>
          <Li>
            Salon öz səhifəsində dərc etdiyi məlumatların (xidmətlər, qiymətlər, iş saatları)
            düzgünlüyünə görə məsuliyyət daşıyır;
          </Li>
          <Li>
            Salon müştərilərinin telefon nömrələrini yalnız görüşlə bağlı bildirişlər üçün
            istifadə etməyə və bunun üçün müştəri razılığının olmasına görə məsuliyyət daşıyır.
          </Li>
        </Ul>
      </Section>

      <Section title="3. Qadağan olunan istifadə">
        <Ul>
          <Li>Yalan və ya başqasının adından qeydiyyatlar yaratmaq;</Li>
          <Li>Platformadan spam və ya arzuolunmaz mesajlar göndərmək üçün istifadə etmək;</Li>
          <Li>Platformanın işinə müdaxilə etmək, avtomatlaşdırılmış kütləvi sorğular göndərmək;</Li>
          <Li>Qanunvericiliyə zidd fəaliyyət üçün istifadə etmək.</Li>
        </Ul>
        <P>
          Bu qaydaları pozan hesablar xəbərdarlıq edilmədən dayandırıla və ya silinə bilər.
        </P>
      </Section>

      <Section title="4. Tariflər və ödəniş">
        <P>
          Platforma pulsuz sınaq müddəti və ödənişli tarif planları ilə işləyir. Aktual
          qiymətlər saytın &quot;Qiymətlər&quot; bölməsində göstərilir və AZN ilə hesablanır.
          Ödənişlər hazırda birbaşa (manual) qaydada qəbul olunur — ətraflı məlumat üçün
          bizimlə əlaqə saxlayın. Tariflər əvvəlcədən bildirilməklə dəyişdirilə bilər.
        </P>
      </Section>

      <Section title="5. WhatsApp bildirişləri">
        <P>
          Görüş təsdiqi və xatırlatmalar WhatsApp Business API (Meta Platforms) vasitəsilə
          göndərilir. Mesajların çatdırılması Meta-nın xidmətindən asılıdır və Platforma
          çatdırılmaya tam zəmanət vermir. Ləğv edilmiş görüşlər üçün xatırlatma göndərilmir.
        </P>
      </Section>

      <Section title="6. Xidmətin əlçatanlığı və məsuliyyətin məhdudlaşdırılması">
        <P>
          Platformanın fasiləsiz işləməsi üçün ağlabatan səylər göstəririk, lakin xidmət
          &quot;olduğu kimi&quot; təqdim olunur. Texniki fasilələr, üçüncü tərəf xidmətlərinin
          (hostinq, WhatsApp) dayanması və ya fors-major hallar nəticəsində yaranan itkilərə
          görə Platforma məsuliyyət daşımır. Salon ilə müştəri arasındakı münasibətlərin
          (xidmətin keyfiyyəti, ödəniş və s.) tərəfi Platforma deyil.
        </P>
      </Section>

      <Section title="7. Şəxsi məlumatlar">
        <P>
          Şəxsi məlumatların toplanması və istifadəsi qaydaları ayrıca{" "}
          <a href="/privacy" className="text-accent underline underline-offset-2">
            Məxfilik Siyasətində
          </a>{" "}
          təsvir olunub.
        </P>
      </Section>

      <Section title="8. Dəyişikliklər və xitam">
        <P>
          Bu şərtlər zaman-zaman yenilənə bilər; davam edən istifadə yenilənmiş şərtlərin
          qəbulu sayılır. Hesabınızı istənilən vaxt bağlaya bilərsiniz — bunun üçün bizimlə
          əlaqə saxlayın.
        </P>
      </Section>

      <Section title="9. Tətbiq olunan hüquq və əlaqə">
        <P>
          Bu şərtlər Azərbaycan Respublikasının qanunvericiliyi ilə tənzimlənir. Suallar
          üçün: WhatsApp {CONTACT_WA}.
        </P>
      </Section>
    </LegalShell>
  );
}
