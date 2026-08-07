#!/usr/bin/env python3
import argparse, datetime, json, pathlib, plistlib, re, zipfile

MAIN_BUNDLE = "com.louismollick.substreamer.dev"

def validate(ipa_path, manifest, repository, release_tag, asset_name):
    ipa_path = pathlib.Path(ipa_path)
    with zipfile.ZipFile(ipa_path) as ipa:
        names = ipa.namelist()
        corrupt = ipa.testzip()
        if corrupt: raise ValueError(f"corrupt ZIP member: {corrupt}")
        apps = {match.group(1) for name in names if (match := re.match(r"^(Payload/[^/]+\.app)(?:/|$)", name))}
        if len(apps) != 1: raise ValueError(f"expected exactly one top-level app, found {len(apps)}")
        infos = [n for n in names if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", n)]
        if len(infos) != 1: raise ValueError(f"expected exactly one top-level app, found {len(infos)}")
        prefix = infos[0][:-len("Info.plist")]
        if prefix + "main.jsbundle" not in names: raise ValueError("missing main.jsbundle")
        extensions = [n for n in names if re.search(r"\.appex(?:/|$)", n)]
        if extensions: raise ValueError("unexpected app extension")
        try: info = plistlib.loads(ipa.read(infos[0]))
        except Exception as error: raise ValueError("malformed Info.plist") from error
    required = {"channel", "commitSHA", "bundleIdentifier", "version", "buildVersion"}
    if not required <= manifest.keys(): raise ValueError("manifest missing required fields")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest["commitSHA"], re.I): raise ValueError("manifest SHA must be 40 hexadecimal characters")
    channel = manifest["channel"]
    if channel not in ("main", "pr"): raise ValueError("channel must be main or pr")
    expected = MAIN_BUNDLE if channel == "main" else f"com.louismollick.substreamer.pr{int(manifest['prNumber'])}"
    if manifest["bundleIdentifier"] != expected: raise ValueError("manifest bundle identifier does not match channel")
    for key, plist_key in (("bundleIdentifier", "CFBundleIdentifier"), ("version", "CFBundleShortVersionString"), ("buildVersion", "CFBundleVersion")):
        if str(info.get(plist_key, "")) != str(manifest[key]): raise ValueError(f"{key} does not match IPA")
    if not info.get("MinimumOSVersion"): raise ValueError("IPA is missing MinimumOSVersion")
    return {"channel": channel, **({"prNumber": int(manifest["prNumber"]), "title": manifest["title"], "htmlURL": manifest["htmlURL"]} if channel == "pr" else {}),
      "headSHA": manifest["commitSHA"], "bundleIdentifier": expected, "version": str(info["CFBundleShortVersionString"]), "buildVersion": str(info["CFBundleVersion"]),
      "date": datetime.datetime.now(datetime.timezone.utc).isoformat(), "downloadURL": f"https://github.com/{repository}/releases/download/{release_tag}/{asset_name}",
      "size": ipa_path.stat().st_size, "minOSVersion": str(info["MinimumOSVersion"]),
      "privacy": {k: v for k, v in info.items() if re.fullmatch(r"NS.*UsageDescription", k) and isinstance(v, str)}}

def main():
    p=argparse.ArgumentParser(); p.add_argument("ipa"); p.add_argument("manifest"); p.add_argument("repository"); p.add_argument("release_tag"); p.add_argument("asset_name"); p.add_argument("output")
    a=p.parse_args(); manifest=json.loads(pathlib.Path(a.manifest).read_text()); metadata=validate(a.ipa, manifest, a.repository, a.release_tag, a.asset_name); pathlib.Path(a.output).write_text(json.dumps(metadata, indent=2)+"\n")
if __name__ == "__main__": main()
