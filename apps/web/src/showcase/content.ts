import type { ReviewSnapshot } from '../review/types';
import type { RoadmapProjection } from '../roadmap/model';

export const PRODUCT_LOOP = [
  {
    number: '01',
    title: "Holatni aniqlash",
    description:
      "O'quvchi tayyorgarlik holatini mashq orqali ko'radi; ochiq namuna faqat sintetik ma'lumot ishlatadi.",
  },
  {
    number: '02',
    title: "Keyingi qadam",
    description:
      "Yo'l xaritasi bajarilgan ish va mavjud bosqichni bitta tushunarli ko'rinishga aylantiradi.",
  },
  {
    number: '03',
    title: 'Offline mashq',
    description:
      "Mobil yadro javobni avval qurilmada saqlaydi, so'ng aloqa tiklanganda tartib bilan sinxronlaydi.",
  },
  {
    number: '04',
    title: 'Natijani tahlil qilish',
    description:
      "Tekshirilgan snapshot natijani barqaror view-modelga o'tkazadi va xatolarni qayta ishlashga yordam beradi.",
  },
] as const;

export const SUPPORTED_CLIENTS = [
  {
    name: 'Web',
    label: 'Asosiy o‘quv tajribasi',
    detail: 'Roadmap, mashq va natijani tahlil qilish.',
  },
  {
    name: 'Mobile',
    label: 'Offline-first yadro',
    detail: "Internet uzilganda ham javobni yo'qotmaslikka yo'naltirilgan.",
  },
  {
    name: 'Telegram Lite',
    label: 'Yengil kuzatuv',
    detail: 'O‘qish holati uchun faqat ko‘rish rejimidagi Mini App.',
  },
  {
    name: 'Desktop',
    label: 'Sinf protokoli',
    detail: 'Rust va TypeScript orasidagi tekshiriladigan umumiy kontrakt.',
  },
] as const;

export const DIFFERENTIATORS = [
  {
    title: 'Bir martalik test emas',
    description:
      "Mashq, tahlil va navbatdagi bosqich uzluksiz o'rganish sikliga birlashtiriladi.",
  },
  {
    title: 'Aloqaga qaram bo‘lmagan yadro',
    description:
      'Mobil buyruqlar qurilmada chidamli saqlanadi va sessiya tartibida yuboriladi.',
  },
  {
    title: 'Har chegarada tekshiruv',
    description:
      "Tashqi JSON, qurilma buyrug'i va tillararo protokol ishlatilishdan oldin validatsiyadan o'tadi.",
  },
] as const;

export const FAQ = [
  {
    question: "Bu ochiq repozitoriy to'liq Onless mahsulotimi?",
    answer:
      "Yo'q. Bu President Tech Awards ko'rigi uchun tanlangan, ishga tushadigan va sintetik ma'lumotli texnik kesimlar. To'liq mahsulot alohida yopiq repozitoriyda saqlanadi.",
  },
  {
    question: "Demo serverga yoki ishlab turgan akkauntga ulanadimi?",
    answer:
      "Yo'q. Ushbu web namuna faqat fayl ichidagi deterministik fixturelardan foydalanadi va tashqi so'rov yubormaydi.",
  },
  {
    question: "Kod nimani ko'rsatadi?",
    answer:
      "Kontraktni validatsiya qilish, sof proyeksiya, accessibility, offline buyruqlar ketma-ketligi va Rust/TypeScript parity kabi muhim muhandislik qarorlarini.",
  },
] as const;

export const DEMO_ROADMAP = {
  stages: [
    {
      id: 'foundation',
      label: 'Asoslar',
      order: 0,
      status: 'completed',
      progress: { completed: 6, total: 6 },
    },
    {
      id: 'guided-practice',
      label: "Yo'naltirilgan mashq",
      order: 1,
      status: 'completed',
      progress: { completed: 8, total: 8 },
    },
    {
      id: 'independent-practice',
      label: 'Mustaqil mashq',
      order: 2,
      status: 'in_progress',
      progress: { completed: 5, total: 9 },
    },
    {
      id: 'readiness-review',
      label: 'Tayyorgarlik tahlili',
      order: 3,
      status: 'locked',
      progress: { completed: 0, total: 4 },
    },
  ],
} as const satisfies RoadmapProjection;

const SESSION_ID = '10000000-0000-4000-8000-000000000001';
const QUESTION_IDS = [
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
] as const;
const ANSWER_IDS = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006',
] as const;

export const DEMO_REVIEW_EXPECTATION = {
  sessionId: SESSION_ID,
  locale: 'uz',
} as const;

export const DEMO_REVIEW_SNAPSHOT = {
  session_id: SESSION_ID,
  revision: 2,
  status: 'COMPLETED',
  mode: 'training',
  locale: 'uz',
  review_kind: 'question_review',
  exam_id: null,
  ticket_id: null,
  ticket_number: null,
  started_at: '2026-01-15T08:00:00.000Z',
  completed_at: '2026-01-15T08:04:12.000Z',
  time_taken_seconds: 252,
  total_questions: 3,
  total_answered: 2,
  correct_count: 1,
  incorrect_count: 1,
  unanswered_count: 1,
  score_percentage: 33.3,
  has_passed: false,
  questions: [
    {
      question_id: QUESTION_IDS[0],
      position: 1,
      text: "O'rganish siklining birinchi qadami qaysi?",
      text_locale: 'uz',
      image_key: null,
      image_url: null,
      video_key: null,
      video_url: null,
      ticket_id: null,
      ticket_position: null,
      ticket_number: null,
      answers: [
        {
          answer_id: ANSWER_IDS[0],
          display_order: 1,
          text: 'Hozirgi holatni aniqlash',
          text_locale: 'uz',
          is_selected: true,
          is_correct: true,
        },
        {
          answer_id: ANSWER_IDS[1],
          display_order: 2,
          text: 'Natijani tekshirmasdan davom etish',
          text_locale: 'uz',
          is_selected: false,
          is_correct: false,
        },
      ],
      correct_answer_id: ANSWER_IDS[0],
      selected_answer_id: ANSWER_IDS[0],
      is_correct: true,
      is_unanswered: false,
      time_spent_seconds: 44,
      explanation_available: false,
    },
    {
      question_id: QUESTION_IDS[1],
      position: 2,
      text: "Offline javob qachon qurilmada saqlanishi kerak?",
      text_locale: 'uz',
      image_key: null,
      image_url: null,
      video_key: null,
      video_url: null,
      ticket_id: null,
      ticket_position: null,
      ticket_number: null,
      answers: [
        {
          answer_id: ANSWER_IDS[2],
          display_order: 1,
          text: "Tarmoqqa yuborishdan oldin",
          text_locale: 'uz',
          is_selected: false,
          is_correct: true,
        },
        {
          answer_id: ANSWER_IDS[3],
          display_order: 2,
          text: "Faqat server tasdiqlagandan keyin",
          text_locale: 'uz',
          is_selected: true,
          is_correct: false,
        },
      ],
      correct_answer_id: ANSWER_IDS[2],
      selected_answer_id: ANSWER_IDS[3],
      is_correct: false,
      is_unanswered: false,
      time_spent_seconds: 87,
      explanation_available: true,
    },
    {
      question_id: QUESTION_IDS[2],
      position: 3,
      text: "Kontrakt chegarasida noma'lum JSON qanday qabul qilinadi?",
      text_locale: 'uz',
      image_key: null,
      image_url: null,
      video_key: null,
      video_url: null,
      ticket_id: null,
      ticket_position: null,
      ticket_number: null,
      answers: [
        {
          answer_id: ANSWER_IDS[4],
          display_order: 1,
          text: "Avval tekshiriladi, keyin ichki modelga o'tkaziladi",
          text_locale: 'uz',
          is_selected: false,
          is_correct: true,
        },
        {
          answer_id: ANSWER_IDS[5],
          display_order: 2,
          text: "Tekshiruvsiz komponentga uzatiladi",
          text_locale: 'uz',
          is_selected: false,
          is_correct: false,
        },
      ],
      correct_answer_id: ANSWER_IDS[4],
      selected_answer_id: null,
      is_correct: null,
      is_unanswered: true,
      time_spent_seconds: 0,
      explanation_available: false,
    },
  ],
} as const satisfies ReviewSnapshot;
