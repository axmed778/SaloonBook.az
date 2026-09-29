// The words people type when they look for a task, per guide, in all three
// languages at once — an owner may type Russian into the Azerbaijani UI — plus
// the Latin spellings people use on a phone keyboard without the right layout
// ("otpusk", "mezuniyyet"). The guide's own title in the UI's language is
// searched too (search.ts); these are the words the title does not contain.
//
// Not UI text: nothing here is ever shown, so it lives with the code rather
// than in messages/. registry.test.ts checks every guide has an entry.

import type { GuideId } from "./registry";

export const GUIDE_SYNONYMS: Record<GuideId, readonly string[]> = {
  salonProfile: [
    "профиль салона", "телефон салона", "адрес", "контакты", "название салона", "описание",
    "salon məlumatları", "profil", "ünvan", "telefon", "əlaqə", "unvan",
    "salon profile", "details", "address", "phone number", "contacts",
    "profil salona", "adres",
  ],
  addService: [
    "услуга", "услуги", "добавить услугу", "прайс", "цены", "стрижка", "маникюр", "прайс-лист",
    "xidmət", "xidmətlər", "qiymət", "qiymətlər", "xidmet", "qiymet",
    "service", "services", "price list", "prices", "treatment",
    "usluga", "uslugi", "prays",
  ],
  addAddon: [
    "доп", "дополнительная услуга", "допы", "добавка", "опция", "френч",
    "əlavə", "əlavə xidmət", "elave", "elave xidmet",
    "add-on", "addon", "extra", "extras", "upsell", "option",
    "dop", "dopolnitelnaya",
  ],
  addWorker: [
    "мастер", "мастера", "сотрудник", "работник", "персонал", "команда", "добавить мастера",
    "usta", "ustalar", "işçi", "işçilər", "əməkdaş", "isci", "iscilər", "emekdas",
    "staff", "worker", "employee", "master", "stylist", "team member",
    "sotrudnik", "rabotnik",
  ],
  workingHours: [
    "часы работы", "график", "расписание", "рабочие часы", "время работы", "смена", "выходной",
    "iş saatları", "iş qrafiki", "qrafik", "cədvəl", "is saatlari", "qrafik", "cedvel", "istirahət günü",
    "working hours", "schedule", "opening hours", "shift", "day off",
    "grafik", "raspisanie",
  ],
  bookingLink: [
    "ссылка", "ссылка для записи", "инстаграм", "instagram", "био", "bio", "онлайн запись", "поделиться",
    "link", "keçid", "yazılış linki", "onlayn yazılış", "kecid",
    "booking link", "share", "online booking", "qr",
    "ssylka", "insta",
  ],
  manualBooking: [
    "запись", "записать клиента", "новая запись", "создать запись", "бронь", "тестовая запись", "клиент позвонил",
    "görüş", "yeni görüş", "yazmaq", "müştəri yaz", "rezerv", "gorus", "yeni gorus",
    "booking", "appointment", "new booking", "book a client", "reservation",
    "zapis", "bron",
  ],
  masterLogin: [
    "логин", "пароль", "доступ", "вход", "аккаунт мастера", "учётная запись", "войти", "логин мастеру",
    "giriş", "şifrə", "hesab", "daxil olmaq", "giris", "sifre", "parol",
    "login", "password", "access", "account", "sign in",
    "parol", "dostup", "vhod",
  ],
  timeOff: [
    "отпуск", "больничный", "выходные", "отгул", "не работает", "отсутствие",
    "məzuniyyət", "istirahət", "xəstəlik", "mezuniyyet", "istirahet",
    "time off", "vacation", "holiday", "leave", "sick day", "absence",
    "otpusk", "otgul",
  ],
  timeOffReception: [
    "отпуск", "больничный", "выходные", "отгул", "не работает", "отсутствие",
    "məzuniyyət", "istirahət", "xəstəlik", "mezuniyyet", "istirahet",
    "time off", "vacation", "holiday", "leave", "sick day", "absence",
    "otpusk", "otgul",
  ],
  lunchBreak: [
    "перерыв", "обед", "обеденный перерыв", "пауза",
    "fasilə", "nahar", "nahar fasiləsi", "fasile", "fasila",
    "break", "lunch", "lunch break", "pause",
    "pereryv", "obed",
  ],
  payPlan: [
    "оплата", "оплатить", "тариф", "подписка", "продлить", "платёж", "цена тарифа", "сменить тариф",
    "ödəniş", "ödəmək", "tarif", "abunə", "uzatmaq", "odenis", "odemek", "abune",
    "pay", "payment", "plan", "subscription", "upgrade", "renew", "billing",
    "oplata", "podpiska",
  ],
};
