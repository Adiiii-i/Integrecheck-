import http.server
import socketserver
import json
import urllib.request
import os

PORT = int(os.environ.get('PORT', 5005))
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
# Using Env Variable for security! Add NVIDIA_API_KEY to your Railway/Render Environment settings
API_KEY = os.environ.get('NVIDIA_API_KEY', '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')

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/analyze':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                # Forward to NVIDIA with a strict timeout
                req = urllib.request.Request(
                    NVIDIA_URL,
                    data=post_data,
                    headers={
                        "Authorization": f"Bearer {API_KEY}",
                        "Content-Type": "application/json"
                    },
                    method="POST"
                )
                
                with urllib.request.urlopen(req, timeout=45) as response:
                    res_data = response.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(res_data)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            # Change directory to frontend to serve static files correctly
            os.chdir('../frontend')
            super().do_GET()
            os.chdir('../backend')

    def do_GET(self):
        # Serve frontend files
        if self.path == '/':
            self.path = '/index.html'
        
        # Adjust path to look into the frontend directory
        original_path = self.path
        if not self.path.startswith('/api'):
            filepath = os.path.join('../frontend', self.path.lstrip('/'))
            if os.path.exists(filepath):
                self.directory = '../frontend'
                return super().do_GET()
        
        self.send_response(404)
        self.end_headers()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Handle requests in a separate thread."""
    allow_reuse_address = True

if __name__ == "__main__":
    # Ensure current directory is backend
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with ThreadedHTTPServer(("", PORT), ProxyHandler) as httpd:
        print("\n" + "="*45)
        print("🚀 INTEGRECHECK AI-ONLY BACKEND")
        print(f"🔗 PORT: {PORT}")
        print("="*45 + "\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down...")
