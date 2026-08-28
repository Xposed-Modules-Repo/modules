from builtins import RuntimeError

import requests
from io import BytesIO
from zipfile import ZipFile
from axml.axml import AXMLPrinter
from os import getenv
import git


def update_release(bearer_token, org_repo, release_id, data):
    resp = requests.patch(
        f"https://api.github.com/repos/{org_repo}/releases/{release_id}",
        json=data,
        headers={
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {bearer_token}",
        },
    )
    resp.raise_for_status()


def main():
    org_repo = getenv("REPO")
    release = getenv("RELEASE")
    apk = getenv("APK")
    tag_name = getenv("TAG")
    bearer_token = getenv("TAG_TOKEN")

    if not bearer_token:
        raise RuntimeError("TAG_TOKEN is missing")

    with requests.get(apk, stream=True, timeout=10) as r:
        if r.status_code == 404 or r.status_code == 422:
            return
        r.raise_for_status()
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
                        versionName = p.androidversion["Name"]
                else:
                    update_release(bearer_token, org_repo, release, {"draft": True})
                    return

    repo_name = org_repo if "/" not in org_repo else org_repo.split("/")[1]
    if package != repo_name:
        update_release(bearer_token, org_repo, release, {"draft": True})
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

    update_release(bearer_token, org_repo, release, data={"tag_name": tag_name})


if __name__ == "__main__":
    main()
