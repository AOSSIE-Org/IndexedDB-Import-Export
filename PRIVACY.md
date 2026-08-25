# Privacy Policy

## Introduction

`@aossie-org/idb-backup` (the Library) is committed to protecting your privacy and providing a
transparent and user-friendly experience.

This Privacy Policy explains how the Library handles information when you use it.

The Library follows a privacy-conscious and local-first approach. It collects no information of its
own. All processing happens on the device where it runs, and the Library makes no network requests.

## Scope

The Library is a developer dependency — a package that application developers install and call from
their own code — rather than an end-user product. It has no user interface, no accounts, and no
backend service.

Consequently:

- The Library does not collect, transmit, or retain any information about you.
- Applications that embed the Library remain responsible for their own privacy policy and for the
  data they choose to pass to it. This Privacy Policy does not describe, and cannot speak for, the
  practices of those applications.

If you are an end user who has arrived here from an application that uses the Library, the privacy
policy of that application governs how your data is handled.

## Information and Permissions

The Library only ever touches data that the calling application hands to it:

- The IndexedDB databases and object stores named by the application in a call to `exportDB()` or
  `importDB()`, and the records they contain.
- Backup files that a user explicitly selects through the application, when the application uses
  `readFileAsJSON()`.

The Library does not request or require any browser or device permissions. It does not read device
identifiers, location, contacts, health data, or the file system beyond the file a user explicitly
chooses. It contains no analytics, telemetry, crash reporting, or advertising code.

Information passed to the Library is used only to perform the export or import that the application
requested.

## Data Storage

The Library is designed to minimize the storage and transmission of personal information.

All information is stored locally on your device and is not uploaded to or maintained on any remote
server. Specifically:

- Exported data stays in memory as a JavaScript value until the application does something with it.
- `downloadJSON()` writes a backup file to your device through your browser's normal download
  mechanism.
- `importDB()` writes records into an IndexedDB database in your browser, under the origin of the
  application that called it.

The Library operates no servers and has no remote storage of any kind.

## Data Sharing

The Library does not sell your personal information.

The Library does not use personal information for targeted advertising.

No information is shared with any third parties. The Library's only runtime dependency is
[`idb`](https://github.com/jakearchibald/idb), a client-side wrapper around the browser's IndexedDB
API that likewise makes no network requests.

## Data Security

The Library aims to minimize privacy and security risks by collecting nothing and by performing all
processing locally on your device.

One point deserves particular attention: **backup files are plain, unencrypted JSON.** Any data your
application exports is readable by anyone who obtains the file. The Library does not encrypt,
password-protect, or otherwise obscure exported backups. If a backup may contain sensitive
information, protect the file accordingly — and consider encrypting it in your application before it
leaves the device.

Correspondingly, importing a backup writes whatever that file contains into your database. Only
import files from a source you trust.

No method of electronic storage or transmission can be guaranteed to be completely secure. Users are
also responsible for maintaining the security of their devices and for protecting any information
they choose to export, share, or otherwise make available.

## Data Deletion

Because everything the Library touches is stored locally, you remain in control of it:

- Exported backup files can be deleted from your device like any other file.
- Data in IndexedDB can be removed through the application's own data-clearing features, by clearing
  site data in your browser settings, or by uninstalling the application.
- Calling `importDB()` with the `"overwrite"` strategy deletes the target database before restoring
  it from the backup.

There is no server-side copy of your data to request the deletion of, because the Library never
creates one.

## Data Export

The Library exists to let applications export information. Exported files are created and stored on
your device, and you are responsible for protecting any files you choose to export or share. See
[Data Security](#data-security) regarding the unencrypted format of those files.

## Children's Privacy

The Library collects no personal information from anyone, including children, so there is nothing
for it to knowingly collect where such collection is prohibited by applicable law. Any age
requirements applicable to an application that embeds the Library are a matter for that application.

## Free Access

The Library is free and open-source software, licensed under the [GNU General Public License
v3.0](LICENSE). Its full functionality is available without any subscription, payment, license key,
account, or registration, and it performs no activation or entitlement checks of any kind.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes to the Library, its
functionality, or applicable legal requirements.

Any updates will be made available wherever this Privacy Policy is published.

## Contact Us

If you have any questions or concerns about this Privacy Policy or the Library's privacy practices,
please contact us at:

[contact@aossie.org](mailto:contact@aossie.org)
