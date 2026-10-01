import {AwsClient} from 'aws4fetch';

/* Signing only: no object proxy, no R2/GAS requests, no fixed Range header. */
export async function signMapGet(config, map, now){
  const url = new URL(`https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${map.objectKey}`);
  url.searchParams.set('X-Amz-Expires', String(config.ttl));
  const client = new AwsClient({accessKeyId:config.accessKeyId, secretAccessKey:config.secretAccessKey,
    service:'s3', region:'auto'});
  const request = await client.sign(url.href, {method:'GET', aws:{signQuery:true,
    datetime:new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, '')}});
  return request.url;
}
