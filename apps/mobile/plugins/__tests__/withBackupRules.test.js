/* global describe, test, expect */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setBackupAttributes, writeRuleFiles, BACKUP_RULES_XML, DATA_EXTRACTION_RULES_XML, DOMAINS } = require('../withBackupRules');

const manifest = () => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    application: [{ $: { 'android:name': '.MainApplication', 'android:allowBackup': 'false' }, activity: [] }],
  },
});

describe('withBackupRules', () => {
  test('manifest: both attributes reference the generated resources and allowBackup stays false', () => {
    const out = setBackupAttributes(manifest());
    const app = out.manifest.application[0].$;
    expect(app['android:allowBackup']).toBe('false');
    expect(app['android:fullBackupContent']).toBe('@xml/onepeek_backup_rules');
    expect(app['android:dataExtractionRules']).toBe('@xml/onepeek_data_extraction_rules');
  });

  test('every domain is excluded in cloud backup, device transfer and the legacy rules', () => {
    expect(DOMAINS).toEqual(['root', 'file', 'database', 'sharedpref', 'external']);
    for (const d of DOMAINS) {
      const ex = `<exclude domain="${d}" path="." />`;
      expect(BACKUP_RULES_XML).toContain(ex);
      expect(DATA_EXTRACTION_RULES_XML.split(ex)).toHaveLength(3);   // once per section
    }
    expect(DATA_EXTRACTION_RULES_XML).toContain('<cloud-backup disableIfNoEncryptionCapabilities="true">');
    expect(DATA_EXTRACTION_RULES_XML).toContain('<device-transfer>');
    expect(DATA_EXTRACTION_RULES_XML).not.toContain('<include');
    expect(BACKUP_RULES_XML).not.toContain('<include');
  });

  test('writes the two xml files into res/xml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onepeek-backup-'));
    const xml = path.join(dir, 'app', 'src', 'main', 'res', 'xml');
    writeRuleFiles(xml);
    expect(fs.readFileSync(path.join(xml, 'onepeek_backup_rules.xml'), 'utf8')).toBe(BACKUP_RULES_XML);
    expect(fs.readFileSync(path.join(xml, 'onepeek_data_extraction_rules.xml'), 'utf8')).toBe(DATA_EXTRACTION_RULES_XML);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
