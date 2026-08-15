export function ImageGuidance() {
  return (
    <aside className="image-guidance" aria-labelledby="image-guidance-title">
      <h3 id="image-guidance-title">Photo checklist</h3>
      <ul>
        <li>JPEG or PNG, under 10 MB, and at least 512×384 pixels.</li>
        <li>Show one forward-facing adult with their face and intended clothing area visible.</li>
        <li>Stand upright and let the person occupy most of the frame.</li>
      </ul>
      <p>
        Automatic person and composition checks happen at YouCam and may ask you to replace the
        photo.
      </p>
    </aside>
  );
}
