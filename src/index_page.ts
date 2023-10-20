export const index_page = `
<!DOCTYPE html>
<html lang="en">
	<head>
		<title>Sean's Pastebin</title>
    <meta name="viewport" content="width=device-width">
	</head>
<style>
	@media (prefers-color-scheme: dark) {
		body {
			background-color: black;
			color: white;
		}
	}
	body {
		font-family: sans-serif;
	}
	textarea {
		width: 100%;
	}
</style>
<body>
	<div id="container">
		<h1>=== Sean's Pastebin ===</h1>
		<textarea id="paste" rows="20"></textarea>
		<input type="file" name="file" id="file"/>
		<button id="submit">submit</button>
	</div>
</body>
<footer>
	<a href="https://github.com/codebam/pastebin-r2">source code</a>
</footer>
<script>
	const pastebin = async (container, data) => {
		const response = await fetch('https://p.seanbehan.ca', {method: 'POST', body: data})
		const url = await response.text();
		const url_element = document.createElement('p');
		url_element.innerHTML = url;
		container.appendChild(url_element);
	}
	window.onload = async (event) => {
		submit.addEventListener('click', async (event) => {
			container = document.getElementById('container');
			paste = document.getElementById('paste').value;
			submit = document.getElementById('submit');
			file = await new Response(document.getElementById('file').files[0]).blob();
			if (paste !== "") {
				pastebin(container, paste);
			} else if (file !== "" || file.size === 0) {
				pastebin(container, file);
			}
		});
	};
</script>
</html>
`;
