from axml.axml import AXMLPrinter
from builtins import RuntimeError
from io import BytesIO
from os import getenv
from requests import Session
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from zipfile import ZipFile

import git
import os
import re


def escape_data(text: str):
    text = re.sub(r'%', '%25', text)
    text = re.sub(r'\r', '%0D', text)
    return re.sub(r'\n', '%0A', text)

def update_release(session: Session, bearer_token, org_repo, release_id, data):
    resp = session.patch(
        f"https://api.github.com/repos/{org_repo}/releases/{release_id}",
        json=data,
        headers={
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {bearer_token}",
        },
    )
    if not resp.ok:
        print(f"::error::{escape_data(resp.text)}")
        os._exit(1)

def main():
    org_repo = getenv("REPO")
    release = getenv("RELEASE")
    apk = getenv("APK")
    tag_name = getenv("TAG")
    bearer_token = getenv("TAG_TOKEN")

    if not bearer_token:
        raise RuntimeError("TAG_TOKEN is missing")

    session = Session()
    retries = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[502, 503, 504],
        allowed_methods=["GET", "PUT", "DELETE", "PATCH"]
    )
    session.mount('https://', HTTPAdapter(max_retries=retries))

    with session.get(apk, stream=True, timeout=10) as r:
        if r.status_code == 404 or r.status_code == 422:
            return
        if not r.ok:
            print(f"::error::{escape_data(r.text)}")
            os._exit(1)
        with BytesIO(r.content) as zip_buffer:
            with ZipFile(zip_buffer) as zf:
                fn = "AndroidManifest.xml"
                fl = zf.namelist()
                if fn in fl and (
                    "assets/xposed_init" in fl
                    or "META-INF/xposed/java_init.list" in fl
                    or "META-INF/xposed/native_init.list" in fl
                ):
                    with zf.open(fn) as f:
                        p = AXMLPrinter(f.read())
                        package = p.package
                        versionCode = p.androidversion["Code"]
                        versionName = "_".join(p.androidversion["Name"].split())
                else:
                    update_release(session, bearer_token, org_repo, release, {"draft": True})
                    print(f"::error::{escape_data('apk is not a xposed module')}")
                    os._exit(1)
                    return

    repo_name = org_repo if "/" not in org_repo else org_repo.split("/")[1]
    if package != repo_name:
        update_release(session, bearer_token, org_repo, release, {"draft": True})
        print(f"::error::{escape_data('application id mismatched')}")
        os._exit(1)
        return

    tag_name = f"{versionCode}-{versionName}"

    repo = git.Repo.init("./temp.git")
    remote = repo.create_remote(
        "origin", f"https://{bearer_token}@github.com/{org_repo}.git"
    )
    with repo.config_writer("repository") as w:
        w.set_value("user", "name", "github-actions[bot]")
        w.set_value(
            "user", "email", "41898282+github-actions[bot]@users.noreply.github.com"
        )
    repo.index.commit(tag_name)
    repo.create_tag(tag_name, message=tag_name, force=True)
    remote.push(tag_name, force=True)

    update_release(session, bearer_token, org_repo, release, data={"tag_name": tag_name})


if __name__ == "__main__":
    main()
