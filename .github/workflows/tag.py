import requests
from io import BytesIO
from zipfile import ZipFile
from axml.axml import AXMLPrinter
from os import getenv
import git


def main():
    org_repo = getenv("REPO")
    release = getenv("RELEASE")
    apk = getenv("APK")
    tag_name = getenv("TAG")
    tag_token = getenv("TAG_TOKEN")

    if not tag_token:
        raise RuntimeError("TAG_TOKEN is missing")

    with requests.get(apk, stream=True, timeout=10) as r:
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
                    raise RuntimeError("apk is not a Xposed module")

    repo_name = org_repo if "/" not in org_repo else org_repo.split("/")[1]
    if package != repo_name:
        raise RuntimeError(f"package name mismatched {package} != {repo_name}")

    tag_name = f"{versionCode}-{versionName}"

    repo = git.Repo.init("./temp.git")
    repo.config_writer("repository").set_value("user", "name", "github-actions[bot]")
    repo.config_writer("repository").set_value("user", "email", "41898282+github-actions[bot]@users.noreply.github.com")
    repo.index.commit(tag_name)
    repo.create_tag(tag_name, message=tag_name, force=True)
    remote = repo.create_remote("origin", f"https://{tag_token}@github.com/{org_repo}.git")
    remote.push(tag_name, force=True)

    resp = requests.patch(
        f"https://api.github.com/repos/{repo}/releases/{release}",
        data={"tag_name": tag_name},
        headers={
            "Accept": "application/vnd.github.v3+json",
            "Authorization": f"Bearer {tag_token}",
        },
        timeout=10,
    )
    resp.raise_for_status()


if __name__ == "__main__":
    main()
