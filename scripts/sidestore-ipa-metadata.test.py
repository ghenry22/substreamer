import importlib.util, json, pathlib, plistlib, tempfile, unittest, zipfile
PATH=pathlib.Path(__file__).with_name("sidestore-ipa-metadata.py"); SPEC=importlib.util.spec_from_file_location("validator", PATH); MOD=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(MOD)
SHA="1234567890abcdef1234567890abcdef12345678"
class ValidatorTests(unittest.TestCase):
  def fixture(self, info=None, bundle=True, apps=1, appex=False, malformed=False):
    root=tempfile.TemporaryDirectory(); path=pathlib.Path(root.name)/"app.ipa"
    default={"CFBundleIdentifier":"com.louismollick.substreamer.dev","CFBundleShortVersionString":"8.0.91","CFBundleVersion":"1042.1","MinimumOSVersion":"16.0","NSCameraUsageDescription":"Camera"}; default.update(info or {}); default={k:v for k,v in default.items() if v is not None}
    with zipfile.ZipFile(path,"w") as z:
      for n in range(apps): z.writestr(f"Payload/app{n}.app/Info.plist", b"bad" if malformed else plistlib.dumps(default))
      if bundle: z.writestr("Payload/app0.app/main.jsbundle", "bundle")
      if appex: z.writestr("Payload/app0.app/PlugIns/x.appex/x", "x")
    return root,path
  def manifest(self, **kw): return {"channel":"main","commitSHA":SHA,"bundleIdentifier":"com.louismollick.substreamer.dev","version":"8.0.91","buildVersion":"1042.1",**kw}
  def test_valid_main_extracts_privacy_and_minimum_os(self):
    r,p=self.fixture(); self.addCleanup(r.cleanup); out=MOD.validate(p,self.manifest(),"o/r","sidestore-main","x.ipa"); self.assertEqual(out["privacy"],{"NSCameraUsageDescription":"Camera"}); self.assertEqual(out["minOSVersion"],"16.0")
  def test_valid_pr(self):
    r,p=self.fixture({"CFBundleIdentifier":"com.louismollick.substreamer.pr7","CFBundleShortVersionString":"0.7.2"}); self.addCleanup(r.cleanup); out=MOD.validate(p,self.manifest(channel="pr",prNumber=7,title="T",htmlURL="https://x",bundleIdentifier="com.louismollick.substreamer.pr7",version="0.7.2"),"o/r","pr-7-ios-preview","x.ipa"); self.assertEqual(out["prNumber"],7)
  def test_rejects_structure_and_metadata_errors(self):
    cases=[({"bundle":False},"main.jsbundle"),({"apps":2},"exactly one"),({"appex":True},"extension"),({"malformed":True},"malformed")]
    for args,msg in cases:
      r,p=self.fixture(**args); self.addCleanup(r.cleanup)
      with self.assertRaisesRegex(ValueError,msg): MOD.validate(p,self.manifest(),"o/r","t","x")
    r,p=self.fixture(); self.addCleanup(r.cleanup)
    for override,msg in [({"bundleIdentifier":"bad"},"channel"),({"version":"wrong"},"version"),({"buildVersion":"wrong"},"buildVersion"),({"commitSHA":"bad"},"SHA")]:
      with self.assertRaisesRegex(ValueError,msg): MOD.validate(p,self.manifest(**override),"o/r","t","x")
    with self.assertRaisesRegex(ValueError,"channel"): MOD.validate(p,self.manifest(channel="other"),"o/r","t","x")
    r2,p2=self.fixture({"MinimumOSVersion":None}); self.addCleanup(r2.cleanup)
    with self.assertRaisesRegex(ValueError,"MinimumOSVersion"): MOD.validate(p2,self.manifest(),"o/r","t","x")
if __name__ == "__main__": unittest.main()
