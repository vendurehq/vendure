import sharp from 'sharp';

export function createImageWithXmp(
    format: 'jpeg' | 'png' | 'webp',
    width = 400,
    height = 300,
): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: '#88aacc' } })
        .toFormat(format)
        .withXmp(createXmpWithDigitalSourceType())
        .withExifMerge({ IFD0: { Copyright: 'Vendure test' } })
        .toBuffer();
}

export function createXmpWithDigitalSourceType(): string {
    return (
        '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""' +
        ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"' +
        ' Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>' +
        '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
    );
}

export async function hasDigitalSourceType(image: Buffer): Promise<boolean> {
    const { xmp } = await sharp(image).metadata();
    return String(xmp ?? '').includes('trainedAlgorithmicMedia');
}
