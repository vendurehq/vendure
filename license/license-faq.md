# Vendure - Licensing FAQ

## What is the license for Vendure?

Vendure and all contributed files in this Git repository are available under two different licenses:

* GNU General Public License version 3 (GPLv3)
* Vendure Commercial License (VCL)
  If you don't have a separate written licensing agreement between you and Vendure GmbH then always GPLv3 applies to you.

The following FAQ covers only GPLv3.

# GPLv3 FAQ

## What does "licensed under the GPLv3" actually mean?
That means you are free to download, reuse, modify, and distribute
any files hosted in the Vendure Git repository under the terms of the GPL version 3, and to run Vendure in
combination with any code with any license that is compatible with GPL version 3, such as the
Affero General Public License (AGPL) version 3.

## Does the license cover just TypeScript, or everything?
We require that all files in this repository (TypeScript, CSS, HTML) that are not part of a bundled 3rd party library are under the terms of the GPLv3.

## Copyright & contributions
All Vendure contributors retain copyright on their code, but agree to release it under the same licenses as Vendure.
If you are unable or unwilling to contribute a patch under the GPL version 3 and the Vendure Commercial License, do not submit a patch.

## I want to release my work under a different license than GPLv3, is that possible?
Yes. There is a special exception described in the file `plugin-exception.txt` that allows you to distribute Vendure plugins under a different license.
If you modify the Vendure core code, you must still release your changes under the GPLv3.

## The GPL requires that I distribute the "source code" of my files. What does that mean for a web application?
The "source code" of a file means the format that is intended for people to edit.

For TypeScript, CSS, and HTML code, the file itself, without any compression or obfuscation, is its own source code.
The "source code" is whichever version is intended to be edited by people.

## If I write a plugin for my Vendure application, do I have to license it under the GPL?
No. There is a special exception described in the file `plugin-exception.txt` that allows you to 
distribute Vendure plugins under a different license.

## Is it permitted for me to sell Vendure or a Vendure plugin?
Yes. However, any modifications to Vendure Core must be made available under the terms of the GPL version 3.

## Do I have to give the code for my web site to anyone who visits it?

No. The GPL does not consider viewing a web site to count as "distributing",
so you are not required to share the code running on your server.

## I have a question not answered here. What should I do?
**If you have a question about your specific case, please consult with a copyright attorney in your area.**
**We cannot and will not offer legal advice.**

If you have a general question about Vendure licensing or other legal issues,
please post your question in the [Vendure discord community](https://vendure.io/community).

### Credits / License of this FAQ page
This FAQ is based on https://www.drupal.org/licensing/faq (modified)- many thanks to the Drupal Association!
License: Creative Commons Attribution-ShareAlike license 2.0 (http://creativecommons.org/licenses/by-sa/2.0/)   
