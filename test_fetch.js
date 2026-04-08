fetch("http://localhost:5005/api/analyze", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({
        model: "google/gemma-3n-e4b-it",
        messages: [{ role: "user", content: "Compare these two assignments..." }],
        max_tokens: 512,
        temperature: 0.2,
        top_p: 0.7
    })
})
.then(res => res.json())
.then(data => console.log("Success:", data))
.catch(err => console.error("Error:", err));
