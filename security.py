"""Validation shared by the public feed and the administrative API."""

import base64
import io
import json
import re
import threading
import time
import warnings
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError

AFFILIATE_DOMAINS = json.loads(Path(__file__).with_name('marketplace_domains.json').read_text())
MAX_UPLOAD_BYTES = 5_000_000
MAX_IMAGE_PIXELS = 12_000_000
MAX_IMAGE_SIDE = 6000
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
UPLOAD_PATH = re.compile(r'/uploads/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)\Z', re.IGNORECASE)


def reject_constant(value):
    raise ValueError('JSON deve conter valores finitos.')


def unique_fields(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Campo JSON repetido.')
        result[key] = value
    return result


def parse_json(raw):
    return json.loads(raw, parse_constant=reject_constant, object_pairs_hook=unique_fields)


def safe_url(value):
    if not isinstance(value, str) or len(value) > 4000 or re.search(r'[\x00-\x20\x7f\\]', value):
        return ''
    try:
        parsed = urlsplit(value)
        if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password:
            if parsed.port in (None, 443):
                return value
    except ValueError:
        pass
    return ''


def affiliate_url(value):
    if not safe_url(value):
        return ''
    host = urlsplit(value).hostname.lower()
    return value if any(host == domain or host.endswith('.' + domain) for domain in AFFILIATE_DOMAINS) else ''


def group_url(value):
    if not safe_url(value):
        return ''
    parsed = urlsplit(value)
    return value if parsed.hostname == 'chat.whatsapp.com' and re.fullmatch(r'/[A-Za-z0-9_-]+/?', parsed.path) else ''


def upload_path(value):
    return isinstance(value, str) and bool(UPLOAD_PATH.fullmatch(value))


def object_fields(value, allowed, strict):
    if not isinstance(value, dict) or (strict and value.keys() - allowed):
        raise ValueError('Campos inválidos ou desconhecidos.')
    return {key: item for key, item in value.items() if key in allowed}


def text(value, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError('Texto inválido.')
    return value


def collection(value, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError('Quantidade de itens inválida.')
    return value


def clean_content(value, strict=True):
    content = object_fields(value, {'settings', 'groups', 'offers', 'reviews'}, strict)
    settings = object_fields(content.get('settings'), {'name', 'headline', 'description'}, strict)
    for key in ('name', 'headline', 'description'):
        text(settings.get(key), 500, required=True)
    groups = []
    for value in collection(content.get('groups'), 100):
        group = object_fields(value, {'id', 'name', 'description', 'category', 'icon', 'color', 'url', 'photo_url', 'member_count', 'capacity', 'featured'}, strict)
        for key in ('name', 'description', 'category', 'icon', 'color', 'url'):
            text(group.get(key), 1000, required=key in ('name', 'category'))
        if group['color'] not in ('peach', 'lavender', 'sage', 'rose', 'yellow', 'blue'):
            raise ValueError('Cor inválida.')
        if group['url'] and not group_url(group['url']):
            raise ValueError('Convite do WhatsApp inválido.')
        photo = text(group.get('photo_url', ''), 2000)
        if photo and not (upload_path(photo) or safe_url(photo)):
            raise ValueError('Foto inválida.')
        members, capacity = group.get('member_count'), group.get('capacity')
        if members is not None and (type(members) is not int or not 0 <= members <= 1_000_000):
            raise ValueError('Quantidade de participantes inválida.')
        if capacity is not None and (type(capacity) is not int or not 1 <= capacity <= 1_000_000):
            raise ValueError('Capacidade inválida.')
        if members is not None and capacity is not None and members > capacity:
            raise ValueError('Quantidade de participantes acima da capacidade.')
        if 'id' in group:
            text(group['id'], 200, required=True)
        if 'featured' in group and type(group['featured']) is not bool:
            raise ValueError('Destaque inválido.')
        groups.append(group)
    offers = []
    for value in collection(content.get('offers', []), 50):
        offer = object_fields(value, {'id', 'name', 'old', 'price', 'discount', 'icon', 'image', 'url', 'category', 'marketplace', 'group_id', 'group_name', 'group_url', 'alt', 'expires_at', 'published_at', 'source'}, strict)
        text(offer.get('name'), 1000, required=True)
        for key, item in offer.items():
            text(item, 1000)
        if offer.get('url') and not affiliate_url(offer['url']):
            raise ValueError('Use um link afiliado da Shopee ou Mercado Livre.')
        if offer.get('image') and not upload_path(offer['image']):
            raise ValueError('Use uma imagem enviada pelo painel.')
        if offer.get('group_url') and not group_url(offer['group_url']):
            raise ValueError('Convite da oferta inválido.')
        offers.append(offer)
    reviews = []
    for value in collection(content.get('reviews', []), 50):
        review = object_fields(value, {'name', 'comment', 'rating'}, strict)
        text(review.get('name'), 1000, required=True)
        text(review.get('comment'), 1000, required=True)
        if type(review.get('rating')) is not int or not 1 <= review['rating'] <= 5:
            raise ValueError('Nota inválida.')
        reviews.append(review)
    return {'settings': settings, 'groups': groups, 'offers': offers, 'reviews': reviews}


def sanitize_image(encoded):
    """Fully decode an allowed format and write pixels to a fresh image."""
    if not isinstance(encoded, str) or len(encoded) > 6_666_668:
        raise ValueError('Imagem acima de 5 MB.')
    try:
        raw = base64.b64decode(encoded, validate=True)
        if not raw or len(raw) > MAX_UPLOAD_BYTES:
            raise ValueError('Imagem acima de 5 MB.')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=['PNG', 'JPEG', 'WEBP']) as image:
                width, height = image.size
                if max(width, height) > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
                    raise ValueError('Imagem acima do limite de dimensões.')
                image.verify()
            with Image.open(io.BytesIO(raw), formats=['PNG', 'JPEG', 'WEBP']) as image:
                image.load()
                oriented = ImageOps.exif_transpose(image)
                mode = 'RGBA' if 'A' in oriented.getbands() or 'transparency' in oriented.info else 'RGB'
                pixels = oriented.convert(mode)
                clean = Image.new(mode, pixels.size)
                clean.paste(pixels)
                output = io.BytesIO()
                clean.save(output, format='WEBP', quality=90, method=3)
        result = output.getvalue()
        if len(result) > MAX_UPLOAD_BYTES:
            raise ValueError('Imagem processada acima de 5 MB.')
        return result
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError('Imagem inválida ou danificada.') from error


class RateLimiter:
    """Bounded per-process sliding windows, shared safely between threads."""

    def __init__(self, max_keys=4096):
        self.entries = OrderedDict()
        self.lock = threading.Lock()
        self.max_keys = max_keys

    def allow(self, key, limit, window):
        now = time.monotonic()
        with self.lock:
            recent = [stamp for stamp in self.entries.pop(key, []) if stamp > now - window]
            allowed = len(recent) < limit
            if allowed:
                recent.append(now)
            self.entries[key] = recent
            while len(self.entries) > self.max_keys:
                self.entries.popitem(last=False)
            return allowed
