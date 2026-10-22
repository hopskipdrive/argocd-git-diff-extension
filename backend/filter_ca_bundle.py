"""Remove the affected emSign roots without changing other trust anchors."""

import hashlib
import pathlib
import re
import ssl
import sys


# SHA-256 certificate fingerprints: https://bugzilla.mozilla.org/show_bug.cgi?id=1515457
BLOCKED = {
    "125609aa301da0a249b97a8239cb6a34216f44dcac9f3954b14292f2e8c8608f",  # C1
    "bc4d809b15189d78db3e1d8cf4f9726a795da1643ca5f1358e1ddb0edc0d7eb3",  # C3
    "86a1ecba089c4a8d3bbe2734c612ba341d813e043cf9e8a862cd5c57a36bbe6b",  # G3
}

source = pathlib.Path(sys.argv[1]).read_bytes()
certificates = re.findall(
    rb"-----BEGIN CERTIFICATE-----\r?\n.*?-----END CERTIFICATE-----\r?\n?",
    source,
    re.DOTALL,
)
if not certificates or b"".join(certificates) != source:
    raise ValueError("CA bundle contains unexpected data; refusing to rewrite it")

kept = [
    cert
    for cert in certificates
    if hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.decode("ascii"))).hexdigest()
    not in BLOCKED
]
pathlib.Path(sys.argv[2]).write_bytes(b"".join(kept))
print(f"Removed {len(certificates) - len(kept)} affected roots")
