import { useState } from 'react';

import { ReviewPanel } from '../review/review-panel';
import { buildReviewPageViewModel } from '../review/snapshot-contract';
import { projectRoadmap } from '../roadmap/projection';
import { RoadmapView } from '../roadmap/roadmap-view';
import type { RoadmapNode } from '../roadmap/model';
import {
  DEMO_REVIEW_EXPECTATION,
  DEMO_REVIEW_SNAPSHOT,
  DEMO_ROADMAP,
  DIFFERENTIATORS,
  FAQ,
  PRODUCT_LOOP,
  SUPPORTED_CLIENTS,
} from './content';
import './showcase.css';

const REVIEW_VIEW_MODEL = buildReviewPageViewModel(
  DEMO_REVIEW_SNAPSHOT,
  DEMO_REVIEW_EXPECTATION,
);
const ROADMAP_VIEW_MODEL = projectRoadmap(DEMO_ROADMAP);

function Wordmark() {
  return (
    <a className="wordmark" href="#top" aria-label="Onless bosh sahifa">
      <span className="wordmark__mark" aria-hidden="true">O</span>
      <span>onless</span>
    </a>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__copy">
        <span className="hero__badge">President Tech Awards · Public Showcase</span>
        <h1 id="hero-title">
          Tayyorlanishni <em>aniq yo'lga</em> aylantiramiz.
        </h1>
        <p>
          Onless o'quvchining mashqi, natijasi va keyingi qadamini bir o'rganish
          sikliga bog'laydi — web, mobil, Telegram Lite va sinf qurilmalarida.
        </p>
        <div className="hero__actions">
          <a className="button button--primary" href="#roadmap">
            Ishlaydigan namunani ko'rish
          </a>
          <a className="button button--secondary" href="#architecture">
            Muhandislik yondashuvi
          </a>
        </div>
        <dl className="hero__facts">
          <div>
            <dt>4</dt>
            <dd>mahsulot yuzasi</dd>
          </div>
          <div>
            <dt>0</dt>
            <dd>tashqi demo so'rovi</dd>
          </div>
          <div>
            <dt>1</dt>
            <dd>uzluksiz o'rganish sikli</dd>
          </div>
        </dl>
      </div>
      <div className="hero__visual" aria-label="Onless o'rganish sikli">
        <div className="hero-orbit hero-orbit--outer" aria-hidden="true" />
        <div className="hero-orbit hero-orbit--inner" aria-hidden="true" />
        <div className="hero-card hero-card--top">
          <span>01 · HOLAT</span>
          <strong>5/9 mashq</strong>
        </div>
        <div className="hero-card hero-card--right">
          <span>02 · YO'L</span>
          <strong>Keyingi bosqich aniq</strong>
        </div>
        <div className="hero-card hero-card--bottom">
          <span>03 · TAHLIL</span>
          <strong>Xatodan yangi qadam</strong>
        </div>
        <div className="hero__core">
          <span aria-hidden="true">∞</span>
          <strong>O'rganish sikli</strong>
        </div>
      </div>
    </section>
  );
}

function LearningLoop() {
  return (
    <section className="loop" aria-labelledby="loop-title">
      <header className="section-heading">
        <span className="section-kicker">USUL</span>
        <h2 id="loop-title">Natija yo'lning oxiri emas.</h2>
        <p>
          Onless natijani keyingi o'rganish qaroriga aylantiradigan yopiq sikl
          sifatida loyihalangan.
        </p>
      </header>
      <ol className="loop__steps">
        {PRODUCT_LOOP.map((step) => (
          <li key={step.number}>
            <span>{step.number}</span>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClientGrid() {
  return (
    <section className="clients" aria-labelledby="clients-title">
      <header className="section-heading">
        <span className="section-kicker">BIR MAHSULOT · TO'RT YUZA</span>
        <h2 id="clients-title">O'quvchi qayerda bo'lsa, sikl o'sha yerda.</h2>
      </header>
      <div className="clients__grid">
        {SUPPORTED_CLIENTS.map((client, index) => (
          <article key={client.name}>
            <span className="clients__index">0{index + 1}</span>
            <h3>{client.name}</h3>
            <strong>{client.label}</strong>
            <p>{client.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section id="architecture" className="architecture" aria-labelledby="architecture-title">
      <header className="section-heading section-heading--light">
        <span className="section-kicker">MUHANDISLIK QARORI</span>
        <h2 id="architecture-title">Har qatlamning bitta aniq vazifasi bor.</h2>
      </header>
      <div className="architecture__flow" aria-label="Dastur qatlamlari">
        <span>Presentation</span>
        <b aria-hidden="true">→</b>
        <span>Domain</span>
        <b aria-hidden="true">→</b>
        <span>Ports</span>
        <b aria-hidden="true">→</b>
        <span>Adapters</span>
      </div>
      <div className="architecture__reasons">
        {DIFFERENTIATORS.map((item) => (
          <article key={item.title}>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function FrequentlyAskedQuestions() {
  return (
    <section className="faq" aria-labelledby="faq-title">
      <header className="section-heading">
        <span className="section-kicker">OCHIQ NAMUNA HAQIDA</span>
        <h2 id="faq-title">Savollar va aniq javoblar.</h2>
      </header>
      <div className="faq__items">
        {FAQ.map((item) => (
          <details key={item.question}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function ShowcaseApp() {
  const [activationMessage, setActivationMessage] = useState('');
  const handleRoadmapActivation = (node: RoadmapNode) => {
    setActivationMessage(`${node.label} bosqichi tanlandi.`);
  };

  return (
    <div id="top" className="site-shell">
      <a className="skip-link" href="#main-content">Asosiy tarkibga o'tish</a>
      <header className="site-header">
        <Wordmark />
        <nav aria-label="Asosiy navigatsiya">
          <a href="#method">Usul</a>
          <a href="#roadmap">Yo'l xaritasi</a>
          <a href="#review">Natija</a>
        </nav>
        <span className="site-header__status">Fixture-only demo</span>
      </header>
      <main id="main-content">
        <Hero />
        <div id="method"><LearningLoop /></div>
        <ClientGrid />
        <div id="roadmap" className="demo-section">
          <RoadmapView
            model={ROADMAP_VIEW_MODEL}
            onActivate={handleRoadmapActivation}
          />
          <p className="visually-hidden" role="status" aria-live="polite">
            {activationMessage}
          </p>
        </div>
        <Architecture />
        <div id="review" className="demo-section">
          <ReviewPanel review={REVIEW_VIEW_MODEL} />
        </div>
        <FrequentlyAskedQuestions />
      </main>
      <footer className="site-footer">
        <Wordmark />
        <p>President Tech Awards uchun tekshiriladigan, sintetik ochiq namuna.</p>
        <a href="mailto:s.yoqubov@onless.uz">s.yoqubov@onless.uz</a>
      </footer>
    </div>
  );
}
