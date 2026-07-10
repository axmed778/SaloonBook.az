import type { Metadata } from "next";
import { LegalShell, Section, P, Ul, Li } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Məxfilik Siyasəti — SalonBook.az",
  description:
    "SalonBook.az-ın şəxsi məlumatların toplanması, istifadəsi və qorunması qaydaları.",
};

const CONTACT_WA = "+994 50 299 04 40";

export default function PrivacyPage() {
  return (
    <LegalShell title="Məxfilik Siyasəti" updated="6 iyul 2026">
      <Section title="1. Ümumi məlumat">
        <P>
          SalonBook.az (bundan sonra — &quot;Platforma&quot;) salonlar, bərbərxanalar və
          klinikalar üçün onlayn qeydiyyat xidmətidir. Bu siyasət Platformadan istifadə zamanı
          hansı şəxsi məlumatların toplandığını, necə istifadə edildiyini və qorunduğunu izah
          edir. Platformadan istifadə etməklə bu siyasətlə razılaşmış olursunuz.
        </P>
      </Section>

      <Section title="2. Topladığımız məlumatlar">
        <P>Aşağıdakı məlumatları toplayırıq:</P>
        <Ul>
          <Li>
            <strong>Salon hesabı məlumatları:</strong> e-poçt ünvanı, ad, salon adı və salon
            profili məlumatları (ünvan, telefon, iş saatları, xidmətlər, işçilər). Şifrələr
            yalnız birtərəfli heş şəklində saxlanılır.
          </Li>
          <Li>
            <strong>Müştəri məlumatları:</strong> onlayn qeydiyyat zamanı daxil edilən ad,
            telefon nömrəsi və seçilmiş görüş məlumatları (xidmət, usta, tarix və saat).
          </Li>
          <Li>
            <strong>Texniki məlumatlar:</strong> təhlükəsizlik və sui-istifadənin qarşısının
            alınması məqsədilə IP ünvanı, sessiya kukisi və oxşar texniki qeydlər.
          </Li>
        </Ul>
      </Section>

      <Section title="3. Məlumatlardan istifadə məqsədləri">
        <Ul>
          <Li>Onlayn qeydiyyat və görüşlərin idarə edilməsi xidmətini göstərmək;</Li>
          <Li>
            WhatsApp vasitəsilə görüşlə bağlı bildirişlər göndərmək (qeydiyyat təsdiqi,
            görüşdən əvvəl xatırlatma, salona yeni görüş barədə məlumat);
          </Li>
          <Li>Hesabın təhlükəsizliyini təmin etmək və sui-istifadənin qarşısını almaq;</Li>
          <Li>Salon sahibinə öz fəaliyyəti barədə statistika göstərmək.</Li>
        </Ul>
        <P>
          WhatsApp bildirişləri yalnız görüşlə bağlı əməliyyat xarakterli mesajlardır —
          telefon nömrənizə reklam və ya marketinq mesajları göndərilmir.
        </P>
      </Section>

      <Section title="4. Məlumatların paylaşılması">
        <P>
          Şəxsi məlumatlarınızı üçüncü tərəflərə satmırıq. Məlumatlar yalnız xidmətin
          göstərilməsi üçün zəruri hallarda paylaşılır:
        </P>
        <Ul>
          <Li>
            <strong>Meta Platforms (WhatsApp Business API)</strong> — bildiriş mesajlarının
            çatdırılması üçün telefon nömrəsi və mesaj məzmunu ötürülür;
          </Li>
          <Li>
            <strong>Hostinq və verilənlər bazası təchizatçıları</strong> — Platformanın
            işləməsi üçün məlumatlar təhlükəsiz serverlərdə saxlanılır;
          </Li>
          <Li>Qanunvericiliklə tələb olunduqda səlahiyyətli dövlət orqanlarına.</Li>
        </Ul>
        <P>
          Müştəri məlumatları yalnız qeydiyyatdan keçdiyi salona görünür — bir salonun
          məlumatları digər salonlara əlçatan deyil.
        </P>
      </Section>

      <Section title="5. Kukilər (cookies)">
        <P>
          Platforma yalnız zəruri kukilərdən istifadə edir: daxil olduqdan sonra sessiyanı
          saxlayan kuki və interfeys seçimləri (məsələn, tema). İzləmə və ya reklam kukiləri
          istifadə edilmir.
        </P>
      </Section>

      <Section title="6. Məlumatların saxlanması və təhlükəsizliyi">
        <P>
          Məlumatlar hesab aktiv olduğu müddətdə saxlanılır. Məlumatların ötürülməsi HTTPS ilə
          şifrələnir, şifrələr heş alqoritmi ilə qorunur və verilənlər bazasına giriş
          məhdudlaşdırılıb.
        </P>
      </Section>

      <Section title="7. Hüquqlarınız">
        <P>
          Şəxsi məlumatlarınıza baxmaq, düzəliş etmək və ya silinməsini tələb etmək
          hüququnuz var. Bunun üçün aşağıdakı əlaqə vasitəsi ilə müraciət edin — müraciətlər
          ağlabatan müddətdə cavablandırılır.
        </P>
      </Section>

      <Section title="8. Dəyişikliklər">
        <P>
          Bu siyasət zaman-zaman yenilənə bilər. Əhəmiyyətli dəyişikliklər bu səhifədə dərc
          olunur və &quot;Son yenilənmə&quot; tarixi yenilənir.
        </P>
      </Section>

      <Section title="9. Əlaqə">
        <P>
          Suallar və müraciətlər üçün: WhatsApp {CONTACT_WA} və ya saytdakı əlaqə
          kanalları.
        </P>
      </Section>
    </LegalShell>
  );
}
