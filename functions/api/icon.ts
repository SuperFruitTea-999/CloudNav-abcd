interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=2592000'
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};

export const onRequestGet = async (context: { env: Env; request: Request }) => {
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');

    if (!domain) {
      return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 1. 尝试从 KV 中获取缓存的图标
    let cachedIcon = await env.CLOUDNAV_KV.get(`favicon:${domain}`);

    // 如果缓存是一个基于 URL 的字符串（原来的老数据），我们主动尝试升级它，下载并转成base64
    if (cachedIcon && cachedIcon.startsWith('http')) {
      try {
        const fetchUrl = cachedIcon;
        const res = await fetch(fetchUrl);
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const contentType = res.headers.get('content-type') || 'image/png';
          
          // 将 ArrayBuffer 转换为 Base64
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64Str = btoa(binary);
          const dataUri = `data:${contentType};base64,${base64Str}`;
          
          // 异步更新 KV 中的缓存
          await env.CLOUDNAV_KV.put(`favicon:${domain}`, dataUri, { expirationTtl: 30 * 24 * 60 * 60 });
          cachedIcon = dataUri;
        }
      } catch (e) {
        console.error('Failed to upgrade old icon format', e);
      }
    }

    // 如果此时缓存已经是 base64 (data:image)
    if (cachedIcon && cachedIcon.startsWith('data:image')) {
      const match = cachedIcon.match(/^data:(image\/[^;]+);base64,(.*)$/);
      if (match) {
        const contentType = match[1];
        const base64Data = match[2];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        return new Response(bytes.buffer, {
          headers: {
            'Content-Type': contentType,
            ...corsHeaders
          }
        });
      }
    }

    // 2. 如果 KV 中没有缓存或者缓存未能成功加载，则代理请求 faviconextractor
    const fetchUrl = `https://www.faviconextractor.com/favicon/${domain}?larger=true`;
    
    try {
      const res = await fetch(fetchUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const contentType = res.headers.get('content-type') || 'image/png';
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'public, max-age=2592000');
        headers.set('Access-Control-Allow-Origin', '*');
        
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Str = btoa(binary);
        const dataUri = `data:${contentType};base64,${base64Str}`;
        
        // 存入 KV，过期时间30天
        await env.CLOUDNAV_KV.put(`favicon:${domain}`, dataUri, { expirationTtl: 30 * 24 * 60 * 60 });
        
        return new Response(buffer, { headers });
      } else {
        return new Response(JSON.stringify({ error: 'Icon fetch failed' }), { 
          status: res.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders } 
        });
      }
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Error fetching icon' }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders } 
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
