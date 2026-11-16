import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import useEmblaCarousel from 'embla-carousel-react';
import { BRAND, DEFAULT_SETTINGS, normalizeText, safeLink, affiliateLink, validGroup, visibleOffers, groupOccupancy, offerGroup } from './lib.js';
import DEFAULT_OFFERS from './data/offers.json';
import './styles.css';
import './enhancements.css';
import './funnel.css';
import vslVideo from '../media/vsl-web.mp4';
import shopeeLogo from './assets/shopee.jpg';
import mercadoLivreLogo from './assets/mercado-livre.png';

const MARKETPLACES = {
  shopee: { name: 'Shopee', logo: shopeeLogo },
  mercado_livre: { name: 'Mercado Livre', logo: mercadoLivreLogo },
};

function MarketplaceMark({ marketplace, showName = true }) {
  const brand = MARKETPLACES[marketplace];
  if (!brand) return <span className="marketplace-mark">Achadinho do grupo</span>;
  return <span className="marketplace-mark"><img src={brand.logo} alt={showName ? '' : brand.name} width="32" height="32" />{showName && <span>{brand.name}</span>}</span>;
}

function MarketplaceTrust() {
  return <div className="marketplace-trust"><div className="marketplace-trust-logos"><MarketplaceMark marketplace="shopee" /><MarketplaceMark marketplace="mercado_livre" /></div><p>Ofertas dessas plataformas. Você compra direto no site ou app oficial.</p></div>;
}

export function Icon({ name = 'arrow', className = '', ...props }) {
  const paths = {
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    diagonal: <><path d="M6 18 18 6M6 6h12v12" /></>,
    down: <><path d="M12 4v16M6 14l6 6 6-6" /></>,
    bag: <><path d="M5 7h14l1 13H4L5 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chat: <path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.1-4.4A8.5 8.5 0 1 1 20 11.5Z" />,
    swipe: <><path d="M3 12h18M6 9l-3 3 3 3M18 9l3 3-3 3" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9L7.5 14 3 9.6l6.2-.9L12 3Z" />,
  };
  return <svg {...props} className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.arrow}</svg>;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function OfferImage({ offer, eager = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [offer.image]);
  if (!offer.image || failed) return <span className="product-image-placeholder"><Icon name="bag" /><span>Imagem indisponível</span></span>;
  return <img className="product-image" src={offer.image} alt={offer.alt || offer.name} draggable="false" loading={eager ? 'eager' : 'lazy'} onError={() => setFailed(true)} />;
}

export function OfferCarousel({ offers, hero = false, onOffer, modalOpen = false }) {
  const reduced = useReducedMotion();
  const [viewportRef, embla] = useEmblaCarousel({ loop: true, align: 'start', duration: reduced ? 0 : 40 });
  const wrapper = useRef(null);
  const [selected, setSelected] = useState(0);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const interacting = useRef(false);
  const resumeAt = useRef(0);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    if (wrapper.current) observer.observe(wrapper.current);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!embla) return;
    const down = () => { interacting.current = true; };
    const up = () => { interacting.current = false; resumeAt.current = Date.now() + 1800; };
    embla.on('pointerDown', down).on('pointerUp', up);
    const timer = setInterval(() => {
      if (modalOpen || !inView || !pageVisible || document.hidden || interacting.current || Date.now() < resumeAt.current || embla.scrollSnapList().length < 2) return;
      if (embla.canScrollNext()) embla.scrollNext(reduced);
      else embla.scrollTo(0, reduced);
    }, reduced ? 6000 : hero ? 3600 : 3800);
    return () => { clearInterval(timer); embla.off('pointerDown', down).off('pointerUp', up); };
  }, [embla, reduced, modalOpen, inView, pageVisible, offers.length, hero]);
  useEffect(() => {
    if (!embla) return;
    const update = () => setSelected(embla.selectedScrollSnap());
    update();
    embla.on('select', update).on('reInit', update);
    return () => { embla.off('select', update).off('reInit', update); };
  }, [embla]);
  const keyboard = event => {
    if (!embla || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resumeAt.current = Date.now() + 5000;
    event.key === 'ArrowRight' ? embla.scrollNext() : embla.scrollPrev();
  };
  return <div ref={wrapper} className={hero ? 'hero-carousel' : 'live-carousel'} aria-roledescription="carrossel" aria-label={hero ? 'Destaques recentes do grupo' : 'Ofertas recentes do grupo'}>
    <div ref={viewportRef} className="carousel-viewport" tabIndex={0} onKeyDown={keyboard}>
      <div className="carousel-container">
        {offers.map((offer, index) => <div className="carousel-slide" key={offer.id || offer.image || `${offer.name}-${index}`}>
          <button className={`product-card ${hero ? 'featured-card' : ''}`} onClick={event => {
            onOffer(offer, event.currentTarget);
          }} aria-label={`Ver opções: ${offer.name}`}>
            <div className="product-image-wrap">
              <OfferImage offer={offer} eager={hero && index === 0} />
              <span className="offer-tag">{offer.discount ? `${offer.discount} OFF` : hero ? 'Achadinho do grupo' : 'No grupo agora'}</span>
              {hero && <span className="image-expand"><Icon name="diagonal" /></span>}
            </div>
            <div className="product-info">
              <span className="product-category">{hero ? 'SELEÇÃO LOPESDAPROMOÇÃO' : 'COMPARTILHADA NO WHATSAPP'}</span>
              <h3>{offer.name}</h3>
              <div className="price-row">
                {offer.old && <div className="old-price"><span>Preço normal</span><s>R$ {offer.old}</s></div>}
                {offer.old && <span className="price-divider" />}
                <div className="new-price"><span>Na promoção</span><strong>{offer.price ? `R$ ${offer.price}` : 'Ver na loja'}</strong></div>
                <span className="card-arrow"><Icon name="diagonal" /></span>
              </div>
            </div>
          </button>
        </div>)}
      </div>
    </div>
    <div className="carousel-footer">
      <span className="swipe-hint"><Icon name="swipe" /> Arraste para explorar</span>
      {hero ? <div className="slide-indicators" aria-hidden="true">{offers.map((_, i) => <span key={i} className={i === selected ? 'active' : ''} />)}</div> : <span className="carousel-count">{String(selected + 1).padStart(2, '0')} <span>/ {String(offers.length).padStart(2, '0')}</span></span>}
    </div>
  </div>;
}

export function OfferDialog({ offer, onClose }) {
  const ref = useRef(null);
  const link = affiliateLink(offer?.url);
  const groupLink = validGroup(offer?.group_url) ? offer.group_url : '';
  useEffect(() => {
    if (!offer) return;
    const dialog = ref.current;
    const focused = document.activeElement;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { document.body.style.overflow = scroll; dialog.close(); if (focused?.isConnected) focused.focus({ preventScroll: true }); };
  }, [offer]);
  if (!offer) return null;
  return createPortal(<dialog ref={ref} className="offer-dialog" aria-labelledby="offer-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="dialog-close" onClick={onClose} aria-label="Fechar oferta"><Icon name="close" /></button>
    <div className="dialog-image-wrap"><OfferImage offer={offer} />{offer.discount && <span className="dialog-discount">{offer.discount} OFF</span>}</div>
    <div className="dialog-copy"><MarketplaceMark marketplace={offer.marketplace} /><h2 id="offer-title">{offer.name}</h2>
      <div className="dialog-prices">{offer.old && <s>R$ {offer.old}</s>}{offer.price && <strong>R$ {offer.price}</strong>}</div>
      <p>Escolha como aproveitar esse achado.</p>
      {link && <a className="btn btn-orange w-full" href={link} target="_blank" rel="noopener noreferrer sponsored">Ver oferta na loja <Icon name="diagonal" /></a>}
      {groupLink ? <a className="btn btn-whatsapp w-full" href={groupLink} target="_blank" rel="noopener noreferrer"><Icon name="chat" /> Entrar no grupo desta oferta <Icon name="diagonal" /></a> : <p className="dialog-group-unavailable">O convite deste grupo ainda não está disponível.</p>}
      {groupLink && <div className="dialog-group-note"><strong>{offer.group_name || 'Grupo de ofertas'}</strong><span>Receba os próximos achados no WhatsApp, sem precisar voltar ao site.</span></div>}
      <small className="dialog-disclaimer">Confira preço, frete e estoque na loja. Podemos receber comissão pela compra.</small>
    </div>
  </dialog>, document.body);
}

export function FloatingPromotions({ offers, onOffer }) {
  const selections = [offers[0], offers[1]].filter(Boolean);
  const example = offers[1];
  const original = Number(example?.old?.replace(',', '.'));
  const current = Number(example?.price?.replace(',', '.'));
  const discount = original > current ? Math.round((1 - current / original) * 100) : null;
  return <>
    <div className="scene-orbit scene-orbit-one" aria-hidden="true" />
    <div className="scene-orbit scene-orbit-two" aria-hidden="true" />
    <span className="scene-spark spark-one" aria-hidden="true">✳</span>
    <span className="scene-spark spark-two" aria-hidden="true">✧</span>
    {selections.map((item, index) => <div className={`floating-promo-position floating-promo-position-${index}`} key={item.id || item.image || item.name}>
      <button className={`floating-promo floating-promo-${index}`} onClick={() => onOffer(item)} aria-label={`Explorar destaque: ${item.name}, R$ ${item.price}`}>
        <span className="floating-promo-image"><img src={item.image} alt="" loading="lazy" draggable="false" /></span>
        <span className="floating-promo-copy"><span>{index ? 'Mais um achadinho' : 'Oferta do grupo'}</span><strong>{item.price ? `R$ ${item.price}` : 'Ver oferta'}</strong>{item.old && <s>R$ {item.old}</s>}</span>
        <span className="floating-promo-arrow"><Icon name="diagonal" /></span>
      </button>
    </div>)}
    {discount > 0 && <div className="floating-discount-position" aria-hidden="true"><div className="floating-discount"><span>OLHA ESSE ACHADO</span><strong>−{discount}%</strong><small>na oferta do grupo</small></div></div>}
    <div className="floating-message-position" aria-hidden="true"><div className="floating-message"><span><Icon name="chat" /></span><div>Mais um achadinho.<small>Direto do grupo para você.</small></div><Icon name="check" /></div></div>
  </>;
}

function usePageData(catalog = false) {
  const [content, setContent] = useState({ settings: DEFAULT_SETTINGS, groups: [], reviews: [], offers: DEFAULT_OFFERS });
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/content', { signal: abort.signal }).then(response => { if (!response.ok) throw Error(); return response.json(); }).then(setContent).catch(() => {}).finally(() => setLoading(false));
    async function refresh() {
      try {
        const response = await fetch(catalog ? '/api/catalog' : '/api/offers', { cache: 'no-store', signal: abort.signal });
        if (response.ok) setFeed(await response.json());
      } catch { /* Retain the current cards during a short connection interruption. */ }
    }
    refresh(); const timer = setInterval(refresh, 60000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [catalog]);
  const connected = feed?.enabled && ['connected', 'cached'].includes(feed.status);
  const offers = useMemo(() => visibleOffers(connected ? feed.offers : content.offers || DEFAULT_OFFERS, Date.now(), catalog ? null : 30), [feed, content.offers, connected, catalog]);
  return { content, offers, connected, loading, updatedAt: feed?.updated_at, liveSync: feed?.status === 'connected' };
}

export function GroupCard({ group }) {
  const available = validGroup(group.url);
  const Tag = available ? 'a' : 'article';
  const occupancy = groupOccupancy(group);
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => setPhotoFailed(false), [group.photo_url]);
  const photo = group.photo_url?.startsWith('/uploads/') ? group.photo_url : safeLink(group.photo_url);
  return <Tag className={`group-card group-preview-card ${available ? 'available' : ''}`} {...(available ? { href: group.url, target: '_blank', rel: 'noopener noreferrer' } : {})}>
    <div className="group-preview-heading"><span className="group-photo">{photo && !photoFailed ? <img src={photo} alt={`Foto do grupo ${group.name}`} loading="lazy" onError={() => setPhotoFailed(true)} /> : <span>{group.name?.trim().slice(0, 1).toUpperCase() || <Icon name="chat" />}</span>}</span><div><span className="group-platform"><Icon name="chat" /> Grupo no WhatsApp</span><span className="group-category">{group.category}</span></div>{occupancy && occupancy.percent >= 90 && occupancy.remaining > 0 && <span className="group-scarcity">Poucas vagas</span>}</div>
    <h3>{group.name}</h3><p>{group.description || 'Acompanhe os achadinhos e as próximas ofertas compartilhadas neste grupo.'}</p>
    {occupancy && <div className="group-occupancy"><div className="occupancy-heading"><strong>{occupancy.percent}% ocupado</strong><span>{occupancy.remainingPercent}% de vagas livres</span></div><div className="occupancy-meter" role="progressbar" aria-label={`Ocupação do grupo ${group.name}`} aria-valuenow={occupancy.members} aria-valuemin={0} aria-valuemax={occupancy.capacity}><span style={{ width: `${occupancy.percent}%` }} /></div><div className="occupancy-details"><span>{occupancy.members} / {occupancy.capacity} participantes</span><span>{occupancy.remaining === 0 ? 'Grupo cheio' : `${occupancy.remaining} vagas`}</span></div><small>Ocupação informada pela administração.</small></div>}
    <div className="group-card-bottom"><span>{available ? 'Ver grupo e participar' : 'Convite em breve'}</span><span className="group-arrow"><Icon name={available ? 'diagonal' : 'chat'} /></span></div>
  </Tag>;
}

export function VslIntro({ onContinue }) {
  const video = useRef(null);
  const watchedUntil = useRef(0);
  const completion = useRef(null);
  const [ended, setEnded] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const attempt = video.current?.play();
    attempt?.catch(() => setNeedsPlay(true));
  }, []);
  useEffect(() => {
    if (!ended) return;
    const dialog = completion.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => { dialog.close(); document.body.style.overflow = oldOverflow; };
  }, [ended]);
  function finish() {
    const element = video.current;
    if (!Number.isFinite(element.duration) || watchedUntil.current < element.duration - 0.5) return;
    if (document.fullscreenElement === element) document.exitFullscreen?.().catch(() => {});
    if (element?.webkitDisplayingFullscreen) element.webkitExitFullscreen?.();
    setEnded(true);
  }
  async function start() {
    try { await video.current.play(); setNeedsPlay(false); }
    catch { setNeedsPlay(true); }
  }
  function trackPlayback() {
    const element = video.current;
    if (!element.seeking) {
      watchedUntil.current = Math.max(watchedUntil.current, element.currentTime);
    }
  }
  function preventSeeking() {
    const element = video.current;
    if (Math.abs(element.currentTime - watchedUntil.current) > 0.1) element.currentTime = watchedUntil.current;
  }
  function retry() {
    setError(false);
    watchedUntil.current = 0;
    video.current.load();
    start();
  }
  return <main className="vsl-page">
    <a href="#" className="brand vsl-brand"><span className="brand-icon"><Icon name="bag" /></span>{BRAND}<span className="brand-period">.</span></a>
    <div className="vsl-heading"><span className="eyebrow"><span className="live-dot" /> SEU PRÓXIMO ACHADO COMEÇA AQUI</span><h1>Antes de comprar,<br /><span>assista a isso.</span></h1><p>Ative o som e descubra um jeito diferente de encontrar boas ofertas.</p></div>
    <MarketplaceTrust />
    <div className="vsl-player-wrap">
      <video ref={video} className="vsl-video" src={vslVideo} autoPlay playsInline disablePictureInPicture disableRemotePlayback controlsList="nodownload nofullscreen noremoteplayback" tabIndex={-1} preload="metadata" onContextMenu={event => event.preventDefault()} onSeeking={preventSeeking} onTimeUpdate={trackPlayback} onRateChange={event => { if (event.currentTarget.playbackRate !== 1) event.currentTarget.playbackRate = 1; }} onPlaying={() => setNeedsPlay(false)} onPause={() => { if (!video.current.ended) setNeedsPlay(true); }} onEnded={finish} onError={() => setError(true)} aria-label="Vídeo de apresentação da lopesdapromoção" />
      {needsPlay && !error && !ended && <button className="vsl-play btn btn-orange" onClick={start}><span aria-hidden="true">▶</span> Assistir com som</button>}
      {error && <div className="vsl-video-error" role="alert"><p>Não foi possível carregar o vídeo.</p><button className="btn btn-orange" onClick={retry}>Tentar novamente</button></div>}
    </div>
    <p className="vsl-footer-note"><Icon name="chat" /> Bons achados. Direto dos nossos grupos.</p>
    {ended && createPortal(<dialog ref={completion} className="vsl-completion" aria-label="Apresentação concluída" onCancel={event => event.preventDefault()}><button className="vsl-final-button" autoFocus onClick={onContinue}>CLICA AQUI</button></dialog>, document.body)}
  </main>;
}

export function Storefront({ onReplay }) {
  const { content, offers, connected, loading, updatedAt, liveSync } = usePageData(true);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [marketplace, setMarketplace] = useState('all');
  const [sort, setSort] = useState('recent');
  const [shown, setShown] = useState(12);
  const groups = content.groups || [];
  const catalogOffers = useMemo(() => offers.map(offer => {
    const group = offerGroup(offer, content.groups || []);
    return { ...offer, group_url: group?.url || '', group_name: group?.name || offer.group_name || '' };
  }), [offers, content.groups]);
  const featured = catalogOffers[0];
  const invitation = catalogOffers.find(offer => offer.group_url)?.group_url || groups.find(group => validGroup(group.url))?.url;
  const name = content.settings?.name || BRAND;
  useEffect(() => { document.title = `${name} — ofertas do grupo`; }, [name]);
  useEffect(() => setShown(12), [query, marketplace, sort]);
  const filtered = useMemo(() => {
    const result = catalogOffers.filter(item => (marketplace === 'all' || item.marketplace === marketplace) && normalizeText(`${item.name} ${item.category || ''}`).includes(normalizeText(query)));
    const price = value => Number(String(value || '').replace(/\./g, '').replace(',', '.')) || Infinity;
    if (sort === 'price') result.sort((a, b) => price(a.price) - price(b.price));
    if (sort === 'discount') result.sort((a, b) => (parseFloat(b.discount) || 0) - (parseFloat(a.discount) || 0));
    return result;
  }, [catalogOffers, query, marketplace, sort]);
  const platforms = [['all', 'Todas as ofertas'], ...[['shopee', 'Shopee'], ['mercado_livre', 'Mercado Livre']].filter(([id]) => offers.some(item => item.marketplace === id))];
  return <>
    <header className="site-header shop-header"><div className="shell shop-header-inner"><a className="brand" href="#loja"><span className="brand-icon"><Icon name="bag" /></span><span>{name}<span className="brand-period">.</span></span></a><nav><button className="shop-replay" onClick={onReplay}>Ver vídeo</button>{invitation && <a className="btn btn-whatsapp btn-small" href={invitation} target="_blank" rel="noopener noreferrer"><Icon name="chat" /><span>Entrar no grupo</span></a>}</nav></div></header>
    <main className="shop-page">
      <section className="shop-intro"><div className="shell shop-hero-layout"><div className="shop-hero-copy"><span className="shop-live-label"><span className="live-dot" /> {connected ? 'PUBLICADAS NOS NOSSOS GRUPOS' : 'SELEÇÃO DE ACHADINHOS'}</span><h1>Tá no grupo.<br /><span>Tá aqui.</span></h1><p>{connected ? 'Essas são as ofertas recentes que estão rolando nos nossos grupos de WhatsApp.' : 'Explore os achadinhos selecionados para você e acompanhe as novidades nos nossos grupos.'} Gostou de alguma? Toque nela e escolha ir direto à loja ou entrar no grupo daquela oferta.</p><div className="shop-hero-actions"><a className="btn btn-dark" href="#ofertas">Explorar ofertas <Icon name="down" /></a><span>Seu próximo achado<br /><strong>a um toque de distância.</strong></span></div><MarketplaceTrust /></div>
        {featured && <div className="shop-hero-feature"><button className="shop-feature-product" onClick={() => setSelected(featured)} aria-label={`Abrir destaque: ${featured.name}`}><div className="shop-feature-heading"><span>ACABOU DE PASSAR NO GRUPO</span><Icon name="diagonal" /></div><div className="shop-feature-image"><OfferImage offer={featured} eager />{featured.discount && <span className="shop-feature-discount"><strong>{featured.discount}</strong><span>OFF</span></span>}</div><div className="shop-feature-copy"><MarketplaceMark marketplace={featured.marketplace} /><h2>{featured.name}</h2><div>{featured.old && <s>R$ {featured.old}</s>}<strong>{featured.price ? `R$ ${featured.price}` : 'Confira na loja'}</strong><span className="shop-feature-arrow"><Icon name="arrow" /></span></div></div></button><div className="shop-feature-caption"><Icon name="chat" /><span>O grupo encontra.<br /><strong>Você aproveita.</strong></span></div></div>}
      </div></section>
      <section className="shop-how shell" aria-label="Como aproveitar"><div><span className="shop-how-icon"><Icon name="bag" /></span><p><strong>Escolha seu achado</strong><span>Toque em uma oferta para ver as opções.</span></p></div><div><span className="shop-how-icon"><Icon name="diagonal" /></span><p><strong>Compre na plataforma</strong><span>O link leva direto à oferta na loja.</span></p></div><div><span className="shop-how-icon green"><Icon name="chat" /></span><p><strong>Fique por dentro no grupo</strong><span>Receba as próximas sem refazer esse caminho.</span></p></div></section>
      {invitation && <section className="shell shop-community"><div className="shop-community-icon"><Icon name="chat" /></div><div><h2>Os próximos achados chegam no WhatsApp.</h2><p>Entre no grupo e receba as novidades por lá, sem precisar assistir ao vídeo de novo.</p></div><a className="btn btn-whatsapp" href={invitation} target="_blank" rel="noopener noreferrer">Quero entrar no grupo <Icon name="diagonal" /></a></section>}
      <section className="shop-catalog shell" id="ofertas"><div className="shop-section-title"><div><span className="eyebrow">SEU FEED DE ACHADINHOS</span><h2>Olha o que tá rolando<span>.</span></h2></div><span className="shop-update"><span className="live-dot" /> {liveSync ? 'Atualiza a cada minuto' : connected && updatedAt ? `Atualizado em ${new Date(updatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'Seleção de ofertas'}</span></div><div className="shop-tools"><label className="shop-search"><Icon name="search" /><input type="search" aria-label="Buscar ofertas" placeholder="O que você está procurando?" value={query} onChange={event => setQuery(event.target.value)} /></label><label className="shop-sort"><span>Ordenar</span><select aria-label="Ordenar ofertas" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Mais recentes</option><option value="price">Menor preço</option><option value="discount">Maior desconto</option></select></label></div>
        <div className="shop-filter-row"><div className="shop-platforms">{platforms.map(([id, text]) => <button key={id} className={`filter-chip ${marketplace === id ? 'active' : ''}`} aria-pressed={marketplace === id} onClick={() => setMarketplace(id)}>{MARKETPLACES[id] && <img src={MARKETPLACES[id].logo} alt="" width="23" height="23" />}{text}</button>)}</div><span className="shop-results">{filtered.length} {filtered.length === 1 ? 'oferta' : 'ofertas'}{connected && <small>Atualização automática · a cada minuto</small>}</span></div>
        <div className="shop-grid">{filtered.slice(0, shown).map((item, index) => {
          return <article className="shop-product" key={item.id || `${item.name}-${index}`}><button className="shop-product-image" onClick={() => setSelected(item)} aria-label={`Ver detalhes: ${item.name}`}><OfferImage offer={item} />{item.discount && <span className="offer-tag">{item.discount} OFF</span>}<span className="image-expand"><Icon name="diagonal" /></span></button><div className="shop-product-info"><MarketplaceMark marketplace={item.marketplace} /><h2><button onClick={() => setSelected(item)}>{item.name}</button></h2><div className="shop-prices">{item.old && <s>R$ {item.old}</s>}<strong>{item.price ? `R$ ${item.price}` : 'Consulte na loja'}</strong></div><div className="shop-product-actions"><button className="btn btn-orange" onClick={() => setSelected(item)}>Ver oferta <Icon name="arrow" /></button>{item.group_url && <a className="shop-join-link" href={item.group_url} target="_blank" rel="noopener noreferrer"><Icon name="chat" /> Entrar no grupo</a>}</div></div></article>;
        })}</div>
        {!filtered.length && <div className="empty-state">{loading ? 'Carregando as ofertas…' : offers.length ? 'Nenhuma oferta encontrada. Tente outra busca.' : 'Nenhuma oferta recente disponível agora. Entre no grupo para acompanhar as próximas.'}</div>}
        {filtered.length > shown && <button className="btn btn-white shop-load-more" onClick={() => setShown(value => value + 12)}>Ver mais ofertas <Icon name="down" /></button>}
        <p className="shop-disclaimer">Preços registrados na publicação, sujeitos a alteração. Confira estoque, frete e condições na loja. Podemos receber comissão pelas compras feitas pelos nossos links.</p>
      </section>
      <section className="shop-groups shell" id="grupos"><div className="section-heading"><div><span className="eyebrow">CONTINUE DESCOBRINDO.</span><h2>O próximo achado.<br /><span className="muted">No seu WhatsApp.</span></h2><p>Escolha seu grupo e acompanhe as próximas ofertas.</p></div></div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">{groups.map((group, i) => <GroupCard key={group.url || i} group={group} />)}</div>{!groups.length && <div className="empty-state">Os convites dos grupos estarão disponíveis aqui em breve.</div>}<p className="privacy-note">Ao entrar, seu número poderá ficar visível aos participantes. Confira as regras do grupo no WhatsApp.</p></section>
    </main>
    <footer className="shell footer"><a className="brand footer-brand" href="#loja">{name}.</a><span>Bons achados para o seu dia a dia.</span><a href="/admin">Área administrativa</a></footer>
    <OfferDialog offer={selected} onClose={() => setSelected(null)} />
  </>;
}

const isShopLocation = () => ['#loja', '#grupos', '#ofertas'].includes(window.location.hash);
export function App() {
  const [shop, setShop] = useState(isShopLocation);
  useEffect(() => {
    const navigate = () => setShop(isShopLocation());
    window.addEventListener('hashchange', navigate); window.addEventListener('popstate', navigate);
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate); };
  }, []);
  function enterShop() { window.history.pushState(null, '', '#loja'); setShop(true); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function replay() { window.history.pushState(null, '', window.location.pathname + window.location.search); setShop(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return shop ? <Storefront onReplay={replay} /> : <VslIntro onContinue={enterShop} />;
}

if (document.getElementById('root')) createRoot(document.getElementById('root')).render(<App />);
