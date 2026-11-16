import hashlib
import hmac
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import sync_catalog


class SyncCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.paths = patch.multiple(sync_catalog, CONFIG=root / 'config.json', STATE=root / 'state.json')
        self.paths.start()
        self.secret = 'c' * 64
        sync_catalog.CONFIG.write_text(json.dumps({'url': 'https://site.test', 'key_id': 'fixture-key', 'secret': self.secret}))
        self.feed = patch.object(sync_catalog.AffiliateFeed, 'read', return_value={'status': 'connected', 'offers': []})
        self.feed.start()

    def tearDown(self):
        self.feed.stop()
        self.paths.stop()
        self.temporary.cleanup()

    def test_signature_matches_exact_bytes_and_acknowledged_state_has_no_pending_operation(self):
        class Opener:
            def open(inner, request, timeout):
                payload = request.data
                headers = dict((key.lower(), value) for key, value in request.header_items())
                canonical = '\n'.join(('v1', 'POST', '/api/sync/catalog', 'fixture-key', headers['x-sync-timestamp'], headers['x-sync-nonce'], headers['x-sync-operation'], hashlib.sha256(payload).hexdigest()))
                expected = hmac.new(bytes.fromhex(self.secret), canonical.encode(), hashlib.sha256).hexdigest()
                self.assertTrue(hmac.compare_digest(expected, headers['x-sync-signature']))
                return io.BytesIO(b'{"ok":true,"sequence":1}')
        with patch.object(sync_catalog, 'build_opener', return_value=Opener()):
            self.assertTrue(sync_catalog.synchronize()['ok'])
        self.assertEqual(json.loads(sync_catalog.STATE.read_text()), {'sequence': 1})

    def test_timeout_preserves_operation_id_and_payload_for_idempotent_retry(self):
        class FailedOpener:
            def open(inner, request, timeout): raise OSError('fixture failure')
        with patch.object(sync_catalog, 'build_opener', return_value=FailedOpener()):
            with self.assertRaises(OSError): sync_catalog.synchronize()
        pending = json.loads(sync_catalog.STATE.read_text())['pending']
        class RetriedOpener:
            def open(inner, request, timeout):
                self.assertEqual(request.get_header('X-sync-operation'), pending['operation'])
                self.assertEqual(json.loads(request.data), pending['payload'])
                return io.BytesIO(b'{"ok":true,"sequence":1}')
        with patch.object(sync_catalog, 'build_opener', return_value=RetriedOpener()):
            self.assertTrue(sync_catalog.synchronize()['ok'])

    def test_offline_upstream_preserves_state_and_outdated_sequence_is_rescheduled(self):
        with patch.object(sync_catalog.AffiliateFeed, 'read', return_value={'status': 'unavailable', 'offers': []}):
            self.assertFalse(sync_catalog.synchronize()['ok'])
            self.assertFalse(sync_catalog.STATE.exists())
        class Opener:
            def open(inner, request, timeout):
                raise HTTPError('https://site.test', 409, 'fixture conflict', {}, io.BytesIO(b'{"code":"sequence_outdated","sequence":7}'))
        with patch.object(sync_catalog, 'build_opener', return_value=Opener()):
            self.assertEqual(sync_catalog.synchronize()['reason'], 'sequence_rescheduled')
        self.assertEqual(json.loads(sync_catalog.STATE.read_text()), {'sequence': 7})


if __name__ == '__main__':
    unittest.main()
