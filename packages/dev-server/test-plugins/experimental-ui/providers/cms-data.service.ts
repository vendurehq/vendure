import { Injectable } from '@angular/core';
import { of } from 'rxjs';

@Injectable()
export class CmsDataService {
    getDataFor(id: string) {
        return of({
            id,
            blogPostUrl: 'https://example.com/blog/' + id,
            blogPostTitle: 'Example Blog Post',
            blogTags: ['tag1', 'tag2', 'tag3'],
        });
    }
}
